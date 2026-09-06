import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Pressable, Platform,
  type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { CheckCircle2, CircleDot, Circle, Plus, ChevronDown, ChevronRight, Check } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import { getPhaseColor, addWorkingDays } from '@/utils/scheduleEngine';
import { orthogonalArrowPath } from '@/utils/ganttArrowPath';
import { parseCalendarDay, addCalendarDays } from '@/utils/calendarDate';
import { startDayNumberFor } from '@/utils/scheduleOps';

interface MobileGanttProps {
  tasks: ScheduleTask[];
  startDate: string; // ISO yyyy-mm-dd
  /** Schedule calendar — startDay is a WORKING-day number, so where a bar sits
   *  on the calendar-day columns depends on which days are worked
   *  (ProjectSchedule.workingDaysPerWeek / nonWorkingDates). Defaults to the
   *  app-wide 5-day week. */
  workingDaysPerWeek?: number;
  nonWorkingDates?: string[];
  selectedDate: Date;
  collapsedPhases: Record<string, boolean>;
  onTogglePhase: (phase: string) => void;
  onPressTask: (task: ScheduleTask) => void;
  onAddTask: () => void;
  onLongPressEmpty?: (iso: string) => void;
  onUpdateTask?: (task: ScheduleTask) => void;
}

const DAY_W = 26;       // 'day' zoom: full-width column
const WEEK_DAY_W = 12;  // 'week' zoom: compact column
const FIT_MIN_W = 6;    // 'fit' zoom: floor so bars stay tappable
const ROW_H = 40;
const HEADER_H = 44;
const LEFT_W = 150;
const MS_DAY = 24 * 60 * 60 * 1000;

// --- VERTICAL WINDOWING ------------------------------------------------------
// This gantt used to render `rows.map(...)` twice — once for the frozen left
// WORK PACKAGES column, once for the bars — inside one plain vertical
// ScrollView, so every row mounted. The importer's hard cap is the realistic N
// (supabase/functions/import-schedule/index.ts, MAX_ROWS = 1000), and each left
// row is a TouchableOpacity + a lucide SVG + two Texts, so a full MS Project
// import built thousands of views in one synchronous pass before the first
// frame and then kept them all alive while scrolling.
//
// Why this is hand-windowed instead of a FlatList (the fix used for the Board
// in app/(tabs)/schedule/index.tsx): this screen is a FROZEN-COLUMN GRID. The
// left column must not scroll horizontally, so it cannot live inside the
// timeline's horizontal ScrollView; the two columns are therefore separate
// subtrees that have to scroll VERTICALLY IN LOCKSTEP. A FlatList per column
// means two scroll owners and a bidirectional offset sync, and the timeline
// also carries three full-content-height absolute overlays (the arrow layer,
// the today line, the selected-day band) plus an absoluteFill long-press
// target, none of which survive being pushed inside a virtualized list's cells
// on iOS (a subview that overflows its superview's bounds renders but does not
// hit-test). Every row here is exactly ROW_H tall, so the window is pure
// arithmetic: keep ONE scroll owner, render the slice, and replace the rest
// with two spacer views of the exact height they occupied.
const OVERSCAN_ROWS = 6;      // rows kept mounted above and below the viewport
const SCROLL_BLOCK_ROWS = 6;  // re-window once per this many rows scrolled, not per frame
const INITIAL_ROWS = 12;      // rows drawn before onLayout reports the real viewport height

// The task name is NOT drawn on the bar. It lives once in the frozen left
// "WORK PACKAGES" column (always visible), so repeating it on the bar — inside
// wide bars, floating outside narrow ones — was redundant and read as
// inconsistent placement. Bars are pure colored duration blocks now (mirrors
// the desktop Gantt, which likewise keeps the name only in the grid row).

type Zoom = 'day' | 'week' | 'fit';

type Row =
  | { kind: 'phase'; phase: string; pct: number }
  | { kind: 'task'; task: ScheduleTask };

function startOfDayMs(d: Date): number { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }

// Local Y/M/D — NOT `toISOString().slice(0, 10)`. Every Date in this file is a
// LOCAL midnight derived from baseMs, and toISOString() re-projects that into
// UTC, so at any POSITIVE UTC offset it emits the PREVIOUS calendar day. The
// long-press-to-add path fed that string straight into AddTaskModal, so the
// column you pressed and the date the new task was prefilled with disagreed.
// Matches GridPane.renderIso, which formats the same way.
function toIsoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// One draggable gantt bar. Hold ~220ms then drag horizontally to reschedule
// (changes startDay); a quick tap opens the task. Drag state is local so only
// this bar re-renders mid-drag, and the reschedule commits once on release.
// Quick swipes still scroll the timeline (activateAfterLongPress yields first).
//
// Positioning is COLUMN-based: dragging snaps to whole columns (dragCols), and
// the on-screen offset is column-quantized (dragCols * dayW). On release we hand
// the raw pixel translation to dragToStartDay, which converts column movement
// back into a WORKING-day startDay (the column it lands on, resolved through
// the schedule calendar); onReschedule still takes a delta in *working days*
// so its contract (and onUpdateTask) is unchanged. This keeps drag correct
// under weekday-only mode and every zoom level.
function GanttBar({ task, x, w, top, dayW, color, done, onPress, onReschedule, dragToStartDay, onDragChange }: {
  task: ScheduleTask; x: number; w: number; top: number; dayW: number; color: string; done: boolean;
  onPress: (t: ScheduleTask) => void; onReschedule: (t: ScheduleTask, deltaDays: number) => void;
  dragToStartDay: (currentStartDay: number, translationX: number) => number;
  onDragChange: (id: string | null) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const [dragCols, setDragCols] = useState<number | null>(null);
  const stepRef = useRef(0);

  // Callbacks are STABLE refs from the parent, so this gesture is NOT recreated
  // when the parent re-renders on drag start (draggingId change) — the active
  // pan stays intact. onDragChange lets the parent hide this task's stale arrows.
  const gesture = useMemo(() => {
    const tap = Gesture.Tap().maxDistance(12).onEnd((_e, ok) => { if (ok) onPress(task); });
    const pan = Gesture.Pan()
      .activateAfterLongPress(220)
      .onStart(() => { stepRef.current = 0; if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDragCols(0); onDragChange(task.id); })
      .onUpdate((e) => {
        const c = Math.round(e.translationX / dayW);
        if (c !== stepRef.current) { stepRef.current = c; if (Platform.OS !== 'web') void Haptics.selectionAsync(); }
        setDragCols(c);
      })
      .onEnd((e) => { onReschedule(task, dragToStartDay(task.startDay ?? 1, e.translationX) - (task.startDay ?? 1)); })
      .onFinalize(() => { setDragCols(null); onDragChange(null); });
    return Gesture.Race(pan, tap);
  }, [task, dayW, onPress, onReschedule, dragToStartDay, onDragChange]);

  const dragging = dragCols !== null;
  const left = Math.max(0, x + (dragging ? (dragCols ?? 0) * dayW : 0));

  return (
    <GestureDetector gesture={gesture}>
      {/* Row wrapper is the positioned + gesture surface. The task name is not
          drawn here — it lives in the frozen left column — so the bar is a
          plain colored block with only a done-check when complete. */}
      <View style={[styles.barRow, { left, top, zIndex: dragging ? 30 : 1 }]}>
        <View style={[styles.bar, { width: w, backgroundColor: color, opacity: done ? 0.5 : 1 }, dragging ? styles.barDragging : null]}>
          {done && (
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
              <Check size={10} color="#FFFFFF" strokeWidth={2.5} />
            </View>
          )}
        </View>
      </View>
    </GestureDetector>
  );
}

export function MobileGantt({
  tasks, startDate, workingDaysPerWeek, nonWorkingDates, selectedDate, collapsedPhases, onTogglePhase, onPressTask, onAddTask, onLongPressEmpty, onUpdateTask,
}: MobileGanttProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // baseMs is LOCAL midnight of schedule day 1. It used to be
  // `startOfDayMs(new Date(startDate))`, and `startDate` is a bare 'YYYY-MM-DD'
  // (MobileScheduleScreen.tsx) — which the spec parses as UTC MIDNIGHT, so at
  // any negative UTC offset (i.e. the entire US market) startOfDayMs floored it
  // to the PREVIOUS local day. Every bar (dayToX), the week-tick labels and
  // isWeekendOffset hang off this anchor, while `todayIdx` below is computed
  // from the real local today — so the whole timeline sat one column LEFT of
  // the today line and a Monday task was drawn under Sunday, reading as
  // already late. It also disagreed with schedule-pro, which anchors on
  // `startDate + 'T00:00:00'`, so auto-stamped actuals landed a column away
  // from where the user tapped. parseCalendarDay (utils/calendarDate.ts) is the
  // shared fix and additionally tolerates the full ISO timestamp Supabase can
  // hand back for this field.
  const baseMs = useMemo(() => startOfDayMs(parseCalendarDay(startDate) ?? new Date()), [startDate]);
  const base = useMemo(() => new Date(baseMs), [baseMs]);
  const wdpw = workingDaysPerWeek ?? 5;
  // The calendar day at column-offset `d` from the anchor, from LOCAL
  // components. B4 review item 2: this was `new Date(baseMs + d * MS_DAY)`,
  // and on the 2026-11-01 fall-back that lands at 23:00 the day BEFORE — every
  // weekend shade, week tick and long-press date after Nov 1 was a day early
  // in Denver. The reverse direction (a local midnight → its offset) stays a
  // millisecond division because Math.round absorbs the 23h/25h day.
  const dayAt = useCallback((d: number): Date => addCalendarDays(base, d), [base]);
  const offsetOf = useCallback((d: Date): number => Math.round((startOfDayMs(d) - baseMs) / MS_DAY), [baseMs]);
  const todayIdx = Math.round((startOfDayMs(new Date()) - baseMs) / MS_DAY);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>('day');
  const [weekdayOnly, setWeekdayOnly] = useState<boolean>(false);
  const [viewportW, setViewportW] = useState<number>(0);
  const handleReschedule = useCallback((t: ScheduleTask, delta: number) => {
    // startDay is 1-indexed (day 1 = schedule start), so floor the clamp at 1.
    const ns = Math.max(1, (t.startDay ?? 1) + delta);
    if (ns !== (t.startDay ?? 1) && onUpdateTask) onUpdateTask({ ...t, startDay: ns });
  }, [onUpdateTask]);

  // True when calendar day-offset `d` (from baseMs) lands on Sat/Sun.
  const isWeekendOffset = useCallback((d: number): boolean => {
    const dow = dayAt(d).getDay(); // 0=Sun .. 6=Sat
    return dow === 0 || dow === 6;
  }, [dayAt]);

  // Ordered phases (first-seen) with rolled-up %.
  const phases = useMemo(() => {
    const order: string[] = [];
    const byPhase = new Map<string, ScheduleTask[]>();
    for (const t of tasks) {
      const p = t.phase || 'Other';
      if (!byPhase.has(p)) { byPhase.set(p, []); order.push(p); }
      byPhase.get(p)!.push(t);
    }
    return order.map((p) => {
      const ts = byPhase.get(p)!;
      const totDur = ts.reduce((s, t) => s + Math.max(1, t.durationDays || 1), 0);
      const pct = totDur > 0 ? Math.round(ts.reduce((s, t) => s + (t.progress || 0) * Math.max(1, t.durationDays || 1), 0) / totDur) : 0;
      return { phase: p, tasks: ts, pct };
    });
  }, [tasks]);

  // Flattened visible rows (respect collapse).
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const ph of phases) {
      out.push({ kind: 'phase', phase: ph.phase, pct: ph.pct });
      if (!collapsedPhases[ph.phase]) for (const t of ph.tasks) out.push({ kind: 'task', task: t });
    }
    return out;
  }, [phases, collapsedPhases]);

  // --- WORKING DAYS → CALENDAR COLUMNS -------------------------------------
  // startDay is a 1-indexed WORKING-day number (the CPM engine, the desktop
  // grid and getTaskDateRange all walk addWorkingDays from the anchor), while
  // a column here is a CALENDAR day-offset. B4 review A9: bars used to be
  // placed at column `startDay - 1` directly, so a startDay-6 task on a
  // Monday anchor was drawn under Saturday instead of the next Monday, and
  // the drift grew by two columns per week down the schedule.
  //
  // Walked ONCE per (anchor, calendar, horizon) rather than per task:
  // workingDayOffset[n] is the calendar day-offset of working day n
  // (0-indexed, so n = startDay - 1), built with the same addWorkingDays every
  // other surface uses. barById then reads it O(1) per task — the same
  // "index it once" shape as the weekday-only column index below.
  const workingDayOffset = useMemo(() => {
    const maxN = tasks.reduce((m, t) => Math.max(m, ((t.startDay ?? 1) - 1) + Math.max(1, t.durationDays || 1)), 0);
    const out: number[] = [0];
    let cur = base;
    for (let n = 1; n <= maxN; n++) {
      cur = addWorkingDays(cur, 1, wdpw, nonWorkingDates);
      out.push(offsetOf(cur));
    }
    return out;
  }, [tasks, base, wdpw, nonWorkingDates, offsetOf]);
  // Calendar day-offset of working day n; past the indexed horizon (only a
  // drag can get there) it walks the same calendar.
  const offsetOfWorkingDay = useCallback((n: number): number => {
    const idx = Math.max(0, n);
    return workingDayOffset[idx] ?? offsetOf(addWorkingDays(base, idx, wdpw, nonWorkingDates));
  }, [workingDayOffset, offsetOf, base, wdpw, nonWorkingDates]);
  // The column just past the last bar (working day maxN is the day AFTER the
  // last task day, so its offset is the exclusive end), floored at a week.
  const maxDay = Math.max(7, workingDayOffset[workingDayOffset.length - 1] ?? 0);
  const numDays = maxDay + 2;

  // --- COLUMN ABSTRACTION ---------------------------------------------------
  // Every horizontal position flows through here so nothing drifts when zoom or
  // weekday-only changes. A "column" is a rendered timeline slot; a "day" is a
  // calendar day-offset from baseMs. In weekday-only mode weekend days collapse
  // out, so columns != days.

  // Weekday-only mode indexed ONCE per (anchor, span) instead of re-walked per
  // call. colOf used to count weekdays from day 0 on every invocation — an O(d)
  // loop doing `new Date(...).getDay()` per step — and barById calls it TWICE
  // PER TASK (bar start and bar end), with weekTicks and every drag frame on top.
  // At the importer's 1,000-row cap that is ~2,000,000 Date constructions per
  // geometry pass, recomputed on every zoom, drag and collapse. Same predicate,
  // same arithmetic, counted once:
  //   colAt[d] = number of weekdays in [0, d)   (exactly what the walk returned)
  //   dayAt[c] = calendar day-offset of the c-th weekday (colToDay's answer)
  // `span` mirrors colToDay's original `numDays + 366` loop guard, including the
  // value it returned when the target column fell past the end.
  const weekdayIndex = useMemo(() => {
    if (!weekdayOnly) return null;
    const span = numDays + 366;
    const colAt = new Int32Array(Math.max(1, numDays + 2));
    const dayAt: number[] = [];
    let cols = 0;
    for (let d = 0; d < span; d++) {
      if (d < colAt.length) colAt[d] = cols;
      if (!isWeekendOffset(d)) { dayAt.push(d); cols++; }
    }
    return { colAt, dayAt, span };
  }, [weekdayOnly, isWeekendOffset, numDays]);

  // colOf(d): index of the column at/just-before calendar day-offset d.
  //   normal: identity. weekday-only: count of weekdays in [0, d).
  const colOf = useCallback((dayOffset: number): number => {
    if (!weekdayOnly) return dayOffset;
    const upper = Math.max(0, Math.floor(dayOffset));
    if (weekdayIndex && upper < weekdayIndex.colAt.length) return weekdayIndex.colAt[upper];
    // Past the indexed span (only reachable by dragging a bar beyond the
    // schedule's own horizon) — fall back to the original walk so the answer is
    // identical either way.
    let cols = 0;
    for (let d = 0; d < upper; d++) if (!isWeekendOffset(d)) cols++;
    return cols;
  }, [weekdayOnly, isWeekendOffset, weekdayIndex]);

  // colToDay(col): inverse of colOf — the calendar day-offset of the col-th
  // visible column (in weekday mode, the col-th weekday from baseMs).
  const colToDay = useCallback((col: number): number => {
    if (!weekdayOnly) return Math.max(0, col);
    const target = Math.max(0, col);
    // The index is built whenever weekdayOnly is on; `?? span` reproduces the
    // old loop's "ran off the end" return value (numDays + 366).
    if (weekdayIndex) return weekdayIndex.dayAt[target] ?? weekdayIndex.span;
    let seen = 0;
    let d = 0;
    // Guard the loop so a pathological drag can't spin forever.
    for (; d < numDays + 366; d++) {
      if (!isWeekendOffset(d)) { if (seen === target) return d; seen++; }
    }
    return d;
  }, [weekdayOnly, isWeekendOffset, numDays, weekdayIndex]);

  const totalCols = useMemo(() => colOf(numDays), [colOf, numDays]);
  const dayW = useMemo(() => {
    if (zoom === 'day') return DAY_W;
    if (zoom === 'week') return WEEK_DAY_W;
    return Math.max(FIT_MIN_W, Math.floor(viewportW / Math.max(1, totalCols)));
  }, [zoom, viewportW, totalCols]);

  const dayToX = useCallback((dayOffset: number): number => colOf(dayOffset) * dayW, [colOf, dayW]);

  // Convert a live pixel drag into a new 1-indexed startDay: the bar's current
  // column comes from its working day, the drop column resolves to a calendar
  // day, and startDayNumberFor turns that back into a working-day number
  // (a drop on a closed day starts the next working day).
  const dragToStartDay = useCallback((currentStartDay: number, translationX: number): number => {
    const targetCol = Math.max(0, colOf(offsetOfWorkingDay(currentStartDay - 1)) + Math.round(translationX / dayW));
    return startDayNumberFor(base, dayAt(colToDay(targetCol)), wdpw, nonWorkingDates);
  }, [colOf, colToDay, dayW, offsetOfWorkingDay, base, dayAt, wdpw, nonWorkingDates]);

  const timelineW = totalCols * dayW;
  const contentH = HEADER_H + rows.length * ROW_H;

  // Selected-day index (from the WeekStrip). The timeline scrolls to it so
  // tapping a day in the strip actually moves the gantt to that day.
  const hScrollRef = useRef<ScrollView>(null);
  const selIdx = useMemo(() => Math.round((startOfDayMs(selectedDate) - baseMs) / MS_DAY), [selectedDate, baseMs]);
  useEffect(() => {
    if (viewportW <= 0) return;
    const clamped = Math.max(0, Math.min(numDays, selIdx));
    const x = dayToX(clamped);
    const maxX = Math.max(0, timelineW - viewportW);
    const target = Math.min(maxX, Math.max(0, x - viewportW / 2 + dayW / 2));
    hScrollRef.current?.scrollTo({ x: target, animated: true });
  }, [selIdx, dayW, viewportW, numDays, timelineW, dayToX]);

  // Bar geometry per task id (for arrows). x/width both go through dayToX so the
  // span stays correct when weekend columns are hidden.
  const barById = useMemo(() => {
    const m = new Map<string, { x: number; w: number; yMid: number }>();
    rows.forEach((r, i) => {
      if (r.kind !== 'task') return;
      // startDay is a 1-indexed WORKING day; dayToX/colOf take a 0-indexed
      // CALENDAR day-offset from baseMs, so both ends go through the index.
      // The bar covers its last working day's column, so the right edge is
      // the column after it.
      const n = (r.task.startDay ?? 1) - 1;
      const x = dayToX(offsetOfWorkingDay(n));
      const endX = dayToX(offsetOfWorkingDay(n + Math.max(1, r.task.durationDays || 1) - 1) + 1);
      const w = Math.max(dayW * 0.6, endX - x - 3);
      m.set(r.task.id, { x, w, yMid: HEADER_H + i * ROW_H + ROW_H / 2 });
    });
    return m;
  }, [rows, dayToX, dayW, offsetOfWorkingDay]);

  // y0/y1 are the arrow's vertical extent in timeline-content coordinates. They
  // are carried on the arrow so the render pass can drop the ones that cannot
  // touch the visible band without re-deriving geometry (a 1,000-task import
  // with dependencies emits ~1,000 <Path> nodes into one Svg, which is the same
  // "mount everything" defect as the rows).
  const arrows = useMemo(() => {
    const out: { id: string; d: string; critical: boolean; from: string; to: string; y0: number; y1: number }[] = [];
    rows.forEach((r) => {
      if (r.kind !== 'task') return;
      const succ = barById.get(r.task.id);
      if (!succ) return;
      const links = r.task.dependencyLinks && r.task.dependencyLinks.length > 0
        ? r.task.dependencyLinks
        : (r.task.dependencies ?? []).map((id) => ({ taskId: id, type: 'FS' as const, lagDays: 0 }));
      for (const link of links) {
        const pred = barById.get(link.taskId);
        if (!pred) continue;
        const d = orthogonalArrowPath(
          { x: pred.x + pred.w, y: pred.yMid },
          { x: succ.x, y: succ.yMid },
        );
        const crit = !!r.task.isCriticalPath;
        out.push({
          id: `${link.taskId}->${r.task.id}`, d, critical: crit, from: link.taskId, to: r.task.id,
          y0: Math.min(pred.yMid, succ.yMid), y1: Math.max(pred.yMid, succ.yMid),
        });
      }
    });
    return out;
  }, [rows, barById]);

  const weekTicks = useMemo(() => {
    const ticks: { x: number; label: string }[] = [];
    for (let d = 0; d < numDays; d += 7) {
      const dt = dayAt(d);
      ticks.push({ x: dayToX(d), label: `${dt.getMonth() + 1}/${dt.getDate()}` });
    }
    return ticks;
  }, [numDays, dayAt, dayToX]);

  const zoomOptions: { key: Zoom; label: string }[] = [
    { key: 'day', label: 'Day' },
    { key: 'week', label: 'Week' },
    { key: 'fit', label: 'Fit' },
  ];

  // --- the vertical window (see the block comment on OVERSCAN_ROWS) ----------
  // ONE scroll owner drives both columns, so there is nothing to keep in sync:
  // the left WORK PACKAGES column and the timeline slice the same [firstRow,
  // lastRow) out of the same `rows` array and both replace the remainder with
  // spacers of the exact height it occupied, which keeps contentH, every bar's
  // `top` and every arrow's y byte-identical to the unwindowed tree.
  const [viewportH, setViewportH] = useState(0);
  const [scrollBlock, setScrollBlock] = useState(0);
  // Distance from the top of the scrollable content down to the first row —
  // the controls bar (font-dependent, so measured) plus the column header. Held
  // in a ref so the scroll handler stays stable across re-renders.
  const rowsTopRef = useRef(0);

  const onGridLayout = useCallback((e: LayoutChangeEvent) => {
    rowsTopRef.current = e.nativeEvent.layout.y + HEADER_H;
  }, []);

  const onOuterLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setViewportH((prev) => (prev === h ? prev : h));
  }, []);

  const onOuterScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y - rowsTopRef.current;
    const block = Math.max(0, Math.floor(y / (ROW_H * SCROLL_BLOCK_ROWS)));
    setScrollBlock((prev) => (prev === block ? prev : block));
  }, []);

  const [firstRow, lastRow] = useMemo(() => {
    // Rows that fit on screen. Before the first onLayout we draw INITIAL_ROWS,
    // the same "small first batch, widen once measured" shape a FlatList uses
    // for initialNumToRender.
    const perScreen = viewportH > 0 ? Math.ceil(viewportH / ROW_H) : INITIAL_ROWS;
    // At block b the topmost visible row index is somewhere in
    // [b * SCROLL_BLOCK_ROWS, (b + 1) * SCROLL_BLOCK_ROWS), so the window has to
    // span that whole block plus a screenful plus the overscan on both sides.
    //
    // `top` is clamped into the list because collapsing a phase shortens `rows`
    // one render BEFORE the ScrollView clamps its own offset and re-fires
    // onScroll, so that frame runs the window against a scrollBlock from the old
    // (much longer) list. Measured unclamped: scrolled to the bottom of 1,006
    // rows and then collapsing every phase left the frozen left column 39,924pt
    // tall against a 284pt timeline — a blank column and a scrollbar that goes
    // nowhere. Clamped it is 324pt, which is exactly HEADER_H + 6 rows + the
    // add row.
    const top = Math.min(scrollBlock * SCROLL_BLOCK_ROWS, Math.max(0, rows.length - 1));
    const first = Math.max(0, top - OVERSCAN_ROWS);
    const last = Math.min(rows.length, Math.max(first, top + SCROLL_BLOCK_ROWS + perScreen + OVERSCAN_ROWS));
    return [first, last] as const;
  }, [viewportH, scrollBlock, rows.length]);

  const visibleRows = useMemo(() => rows.slice(firstRow, lastRow), [rows, firstRow, lastRow]);
  const topSpacerH = firstRow * ROW_H;
  const bottomSpacerH = (rows.length - lastRow) * ROW_H;
  // Arrow band in timeline-content coordinates, padded by one row so a link
  // whose elbow sits just outside the window still draws into it.
  const bandTop = HEADER_H + (firstRow - 1) * ROW_H;
  const bandBottom = HEADER_H + (lastRow + 1) * ROW_H;

  return (
    <ScrollView
      style={styles.outer}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 8 }}
      onLayout={onOuterLayout}
      onScroll={onOuterScroll}
      scrollEventThrottle={16}
    >
      {/* controls — zoom segmented + weekday-only toggle (reduce horizontal scroll) */}
      <View style={styles.controls}>
        <View style={styles.segment}>
          {zoomOptions.map((opt) => {
            const active = zoom === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.segBtn, active ? styles.segBtnActive : null]}
                activeOpacity={0.7}
                onPress={() => setZoom(opt.key)}
                testID={`mobile-gantt-zoom-${opt.key}`}
              >
                <Text style={[styles.segText, active ? styles.segTextActive : null]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          style={[styles.chip, weekdayOnly ? styles.chipActive : null]}
          activeOpacity={0.7}
          onPress={() => setWeekdayOnly((v) => !v)}
          testID="mobile-gantt-weekday-only"
        >
          <Text style={[styles.chipText, weekdayOnly ? styles.chipTextActive : null]}>M–F</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row' }} onLayout={onGridLayout}>
        {/* LEFT — frozen WBS column */}
        <View style={{ width: LEFT_W }}>
          <View style={{ height: HEADER_H, justifyContent: 'flex-end', paddingBottom: 6, paddingLeft: 12 }}>
            <Text style={styles.leftHdr}>WORK PACKAGES</Text>
          </View>
          {/* Rows above the window. `lrow` is a fixed height with border-box
              borders, so N * ROW_H is exactly the space they occupied. */}
          {topSpacerH > 0 && <View style={{ height: topSpacerH }} />}
          {visibleRows.map((r) => r.kind === 'phase' ? (
            <TouchableOpacity key={`p-${r.phase}`} style={[styles.lrow, styles.phaseRow]} activeOpacity={0.7} onPress={() => onTogglePhase(r.phase)}>
              {collapsedPhases[r.phase] ? <ChevronRight size={14} color={colors.textMuted} strokeWidth={1.75} /> : <ChevronDown size={14} color={colors.textMuted} strokeWidth={1.75} />}
              <View style={[styles.phaseDot, { backgroundColor: getPhaseColor(r.phase) }]} />
              <Text style={styles.phaseName} numberOfLines={1}>{r.phase}</Text>
              <Text style={styles.phasePct}>{r.pct}%</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity key={r.task.id} style={[styles.lrow, styles.taskRow]} activeOpacity={0.7} onPress={() => onPressTask(r.task)}>
              {/* Status icons use the status language (done=success,
                  in-progress=info, idle=muted), not the phase palette. */}
              {r.task.status === 'done'
                ? <CheckCircle2 size={15} color={colors.success} strokeWidth={1.75} />
                : r.task.status === 'in_progress'
                  ? <CircleDot size={15} color={colors.info} strokeWidth={1.75} />
                  : <Circle size={15} color={colors.textMuted} strokeWidth={1.75} />}
              <Text style={[styles.taskName, r.task.status === 'done' ? styles.taskNameDone : null]} numberOfLines={1}>{r.task.title}</Text>
            </TouchableOpacity>
          ))}
          {bottomSpacerH > 0 && <View style={{ height: bottomSpacerH }} />}
          <TouchableOpacity style={styles.addRow} activeOpacity={0.7} onPress={onAddTask} testID="mobile-gantt-add">
            <Plus size={15} color={colors.accent} strokeWidth={1.75} />
            <Text style={styles.addText}>New Work Package</Text>
          </TouchableOpacity>
        </View>

        {/* RIGHT — horizontally-scrollable timeline (vertical scroll handled by outer) */}
        <ScrollView
          ref={hScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          onLayout={(e: LayoutChangeEvent) => setViewportW(e.nativeEvent.layout.width)}
        >
          <View style={{ width: timelineW, height: contentH }}>
            {/* long-press empty timeline → add a task at that day */}
            {onLongPressEmpty && (
              <Pressable
                style={StyleSheet.absoluteFill}
                delayLongPress={350}
                onLongPress={(e) => {
                  const day = colToDay(Math.max(0, Math.round(e.nativeEvent.locationX / dayW)));
                  const iso = toIsoDay(dayAt(day));
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  onLongPressEmpty(iso);
                }}
              />
            )}
            {/* week ticks header */}
            <View style={{ height: HEADER_H }}>
              {weekTicks.map((t, i) => (
                <Text key={i} style={[styles.weekTick, { left: t.x + 4 }]}>{t.label}</Text>
              ))}
            </View>
            {/* selected-day band — highlights the day picked in the WeekStrip */}
            {selIdx >= 0 && selIdx < numDays && !(weekdayOnly && isWeekendOffset(selIdx)) && (
              <View style={[styles.selectedBand, { left: dayToX(selIdx), width: dayW, height: contentH }]} />
            )}
            {/* today line — hidden in weekday-only mode if today is a weekend */}
            {todayIdx >= 0 && todayIdx < numDays && !(weekdayOnly && isWeekendOffset(todayIdx)) && (
              <View style={[styles.todayLine, { left: dayToX(todayIdx) + dayW / 2, height: contentH }]} />
            )}
            {/* dependency arrows */}
            <Svg width={timelineW} height={contentH} style={StyleSheet.absoluteFill} pointerEvents="none">
              {arrows.map((a) => (
                a.y1 < bandTop || a.y0 > bandBottom ? null : (
                  <Path key={a.id} d={a.d} stroke={a.critical ? colors.danger : colors.textMuted} strokeWidth={1.25} fill="none" opacity={draggingId && (a.from === draggingId || a.to === draggingId) ? 0 : 0.65} />
                )
              ))}
            </Svg>
            {/* bars (hold ~220ms then drag horizontally to reschedule).
                Every bar is absolutely positioned off `top`, and the container's
                height is the explicit contentH, so the windowed slice needs no
                spacers on this side — the phase rows contributed nothing but an
                empty flow-height View here. */}
            {visibleRows.map((r, k) => {
              const i = firstRow + k;
              if (r.kind !== 'task') return null;
              const g = barById.get(r.task.id)!;
              const done = r.task.status === 'done';
              // Red is reserved for ACTIVE critical work; a completed task isn't
              // "at risk", so done bars use the (de-emphasized) phase color.
              const color = !done && r.task.isCriticalPath ? colors.danger : getPhaseColor(r.task.phase || 'Other');
              return (
                <GanttBar
                  key={r.task.id}
                  task={r.task}
                  x={g.x}
                  w={g.w}
                  top={HEADER_H + i * ROW_H + (ROW_H - 22) / 2}
                  dayW={dayW}
                  color={color}
                  done={done}
                  onPress={onPressTask}
                  onReschedule={handleReschedule}
                  dragToStartDay={dragToStartDay}
                  onDragChange={setDraggingId}
                />
              );
            })}
          </View>
        </ScrollView>
      </View>
    </ScrollView>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  outer: { flex: 1, backgroundColor: t.bg },
  controls: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 10, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  segment: { flexDirection: 'row' as const, backgroundColor: t.surfaceAlt, borderRadius: 8, padding: 2, borderWidth: 1, borderColor: t.line },
  segBtn: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 6 },
  segBtnActive: { backgroundColor: t.accentFill },
  segText: { fontSize: 12, fontWeight: '700' as const, color: t.textMuted },
  segTextActive: { color: '#FFFFFF' },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: t.line, backgroundColor: t.surfaceAlt },
  chipActive: { backgroundColor: t.accentFill, borderColor: t.accent },
  chipText: { fontSize: 12, fontWeight: '700' as const, color: t.textMuted },
  chipTextActive: { color: '#FFFFFF' },
  leftHdr: { fontSize: 9.5, fontWeight: '800' as const, color: t.textMuted, letterSpacing: 0.6 },
  lrow: { height: ROW_H, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: t.line },
  phaseRow: { backgroundColor: t.surfaceAlt },
  taskRow: { paddingLeft: 16 },
  phaseDot: { width: 8, height: 8, borderRadius: 4 },
  phaseName: { flex: 1, fontSize: 12, fontWeight: '800' as const, color: t.text },
  phasePct: { fontSize: 11, fontWeight: '700' as const, color: t.textMuted },
  taskName: { flex: 1, fontSize: 12.5, fontWeight: '600' as const, color: t.text },
  taskNameDone: { color: t.textMuted, textDecorationLine: 'line-through' as const },
  addRow: { height: ROW_H, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: t.line },
  addText: { fontSize: 12, fontWeight: '700' as const, color: t.accent },
  weekTick: { position: 'absolute' as const, bottom: 6, fontSize: 9.5, fontWeight: '700' as const, color: t.textMuted },
  todayLine: { position: 'absolute' as const, top: 0, width: 2, backgroundColor: t.accent, opacity: 0.7 },
  selectedBand: { position: 'absolute' as const, top: 0, backgroundColor: t.accent, opacity: 0.1 },
  barRow: { position: 'absolute' as const, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5 },
  bar: { height: 22, borderRadius: 6, justifyContent: 'center' as const, paddingHorizontal: 7 },
  barDragging: { transform: [{ scale: 1.06 }], shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
});
