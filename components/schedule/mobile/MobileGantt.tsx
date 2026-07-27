import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Pressable, Platform, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { CheckCircle2, CircleDot, Circle, Plus, ChevronDown, ChevronRight, Check } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import { getPhaseColor } from '@/utils/scheduleEngine';
import { orthogonalArrowPath } from '@/utils/ganttArrowPath';
import { outsideLabelSide, OUTSIDE_LABEL_MAX_W } from '@/utils/ganttLabelSide';

interface MobileGanttProps {
  tasks: ScheduleTask[];
  startDate: string; // ISO yyyy-mm-dd
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
// Bars narrower than this can't fit a readable title inside, so the label
// renders OUTSIDE the bar, to its right, in ink (sim-audit #14 — hard
// truncation like "Waterpro…" and unlabeled 1d squares). Each task owns its
// row, so the space right of the bar is free by construction.
const INSIDE_LABEL_MIN_W = 100;

type Zoom = 'day' | 'week' | 'fit';

type Row =
  | { kind: 'phase'; phase: string; pct: number }
  | { kind: 'task'; task: ScheduleTask };

function startOfDayMs(d: Date): number { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }

// One draggable gantt bar. Hold ~220ms then drag horizontally to reschedule
// (changes startDay); a quick tap opens the task. Drag state is local so only
// this bar re-renders mid-drag, and the reschedule commits once on release.
// Quick swipes still scroll the timeline (activateAfterLongPress yields first).
//
// Positioning is COLUMN-based: dragging snaps to whole columns (dragCols), and
// the on-screen offset is column-quantized (dragCols * dayW). On release we hand
// the raw pixel translation to dragToStartDay, which converts column movement
// back into a calendar-day startDay; onReschedule still takes a delta in
// *calendar days* so its contract (and onUpdateTask) is unchanged. This keeps
// drag correct under weekday-only mode and every zoom level.
function GanttBar({ task, x, w, top, dayW, chartW, color, done, onPress, onReschedule, dragToStartDay, onDragChange }: {
  task: ScheduleTask; x: number; w: number; top: number; dayW: number; chartW: number; color: string; done: boolean;
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
  const labelOutside = w < INSIDE_LABEL_MIN_W;
  // Near the right edge the right-side label would run off the chart content
  // and be clipped by the horizontal ScrollView; flip it to the LEFT of the
  // bar (right-aligned, ending at the bar start) so it stays readable.
  const labelSide = labelOutside ? outsideLabelSide(left, w, chartW) : 'right';

  return (
    <GestureDetector gesture={gesture}>
      {/* Row wrapper is the positioned + gesture surface, so tapping an
          outside label opens the task just like tapping the bar. */}
      <View style={[styles.barRow, { left, top, zIndex: dragging ? 30 : 1 }]}>
        {labelOutside && labelSide === 'left' && (
          // Absolutely positioned to the LEFT of the bar (right edge of the
          // label meets the bar's left edge, minus the row gap), right-aligned
          // so the tail sits against the bar.
          <Text
            style={[styles.barTextOutside, styles.barTextOutsideLeft, done ? styles.barTextOutsideDone : null, { right: w + 5 }]}
            numberOfLines={1}
          >
            {task.title}
          </Text>
        )}
        <View style={[styles.bar, { width: w, backgroundColor: color, opacity: done ? 0.5 : 1 }, dragging ? styles.barDragging : null]}>
          {!labelOutside && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              {done && <Check size={10} color="#FFFFFF" strokeWidth={2.5} />}
              <Text style={[styles.barText, { flex: 1 }]} numberOfLines={1}>{task.title}</Text>
            </View>
          )}
        </View>
        {labelOutside && labelSide === 'right' && (
          <Text style={[styles.barTextOutside, done ? styles.barTextOutsideDone : null]} numberOfLines={1}>
            {task.title}
          </Text>
        )}
      </View>
    </GestureDetector>
  );
}

export function MobileGantt({
  tasks, startDate, selectedDate, collapsedPhases, onTogglePhase, onPressTask, onAddTask, onLongPressEmpty, onUpdateTask,
}: MobileGanttProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const baseMs = useMemo(() => startOfDayMs(startDate ? new Date(startDate) : new Date()), [startDate]);
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
    const dow = new Date(baseMs + d * MS_DAY).getDay(); // 0=Sun .. 6=Sat
    return dow === 0 || dow === 6;
  }, [baseMs]);

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

  // startDay is 1-indexed; convert to a 0-indexed day-offset ((startDay ?? 1) - 1)
  // before combining with duration to get the task's end day-offset from baseMs.
  const maxDay = useMemo(() => tasks.reduce((m, t) => Math.max(m, ((t.startDay ?? 1) - 1) + Math.max(1, t.durationDays || 1)), 7), [tasks]);
  const numDays = maxDay + 2;

  // --- COLUMN ABSTRACTION ---------------------------------------------------
  // Every horizontal position flows through here so nothing drifts when zoom or
  // weekday-only changes. A "column" is a rendered timeline slot; a "day" is a
  // calendar day-offset from baseMs. In weekday-only mode weekend days collapse
  // out, so columns != days.

  // colOf(d): index of the column at/just-before calendar day-offset d.
  //   normal: identity. weekday-only: count of weekdays in [0, d).
  const colOf = useCallback((dayOffset: number): number => {
    if (!weekdayOnly) return dayOffset;
    const upper = Math.max(0, Math.floor(dayOffset));
    let cols = 0;
    for (let d = 0; d < upper; d++) if (!isWeekendOffset(d)) cols++;
    return cols;
  }, [weekdayOnly, isWeekendOffset]);

  // colToDay(col): inverse of colOf — the calendar day-offset of the col-th
  // visible column (in weekday mode, the col-th weekday from baseMs).
  const colToDay = useCallback((col: number): number => {
    if (!weekdayOnly) return Math.max(0, col);
    const target = Math.max(0, col);
    let seen = 0;
    let d = 0;
    // Guard the loop so a pathological drag can't spin forever.
    for (; d < numDays + 366; d++) {
      if (!isWeekendOffset(d)) { if (seen === target) return d; seen++; }
    }
    return d;
  }, [weekdayOnly, isWeekendOffset, numDays]);

  const totalCols = useMemo(() => colOf(numDays), [colOf, numDays]);
  const dayW = useMemo(() => {
    if (zoom === 'day') return DAY_W;
    if (zoom === 'week') return WEEK_DAY_W;
    return Math.max(FIT_MIN_W, Math.floor(viewportW / Math.max(1, totalCols)));
  }, [zoom, viewportW, totalCols]);

  const dayToX = useCallback((dayOffset: number): number => colOf(dayOffset) * dayW, [colOf, dayW]);

  // Convert a live pixel drag into a new 1-indexed startDay: startDay maps to a
  // 0-indexed day-offset (startDay - 1) for the column math, then the resulting
  // day-offset (clamped to >= 0) is re-indexed to 1-based on the way out.
  const dragToStartDay = useCallback((currentStartDay: number, translationX: number): number => {
    const targetCol = Math.max(0, colOf(currentStartDay - 1) + Math.round(translationX / dayW));
    return colToDay(targetCol) + 1;
  }, [colOf, colToDay, dayW]);

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
      // startDay is 1-indexed; dayToX/colOf take a 0-indexed day-offset from baseMs.
      const startOffset = (r.task.startDay ?? 1) - 1;
      const x = dayToX(startOffset);
      const endX = dayToX(startOffset + Math.max(1, r.task.durationDays || 1));
      const w = Math.max(dayW * 0.6, endX - x - 3);
      m.set(r.task.id, { x, w, yMid: HEADER_H + i * ROW_H + ROW_H / 2 });
    });
    return m;
  }, [rows, dayToX, dayW]);

  const arrows = useMemo(() => {
    const out: { id: string; d: string; critical: boolean; from: string; to: string }[] = [];
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
        out.push({ id: `${link.taskId}->${r.task.id}`, d, critical: crit, from: link.taskId, to: r.task.id });
      }
    });
    return out;
  }, [rows, barById]);

  const weekTicks = useMemo(() => {
    const ticks: { x: number; label: string }[] = [];
    for (let d = 0; d < numDays; d += 7) {
      const dt = new Date(baseMs + d * MS_DAY);
      ticks.push({ x: dayToX(d), label: `${dt.getMonth() + 1}/${dt.getDate()}` });
    }
    return ticks;
  }, [numDays, baseMs, dayToX]);

  const zoomOptions: { key: Zoom; label: string }[] = [
    { key: 'day', label: 'Day' },
    { key: 'week', label: 'Week' },
    { key: 'fit', label: 'Fit' },
  ];

  return (
    <ScrollView style={styles.outer} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
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

      <View style={{ flexDirection: 'row' }}>
        {/* LEFT — frozen WBS column */}
        <View style={{ width: LEFT_W }}>
          <View style={{ height: HEADER_H, justifyContent: 'flex-end', paddingBottom: 6, paddingLeft: 12 }}>
            <Text style={styles.leftHdr}>WORK PACKAGES</Text>
          </View>
          {rows.map((r, i) => r.kind === 'phase' ? (
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
                  const iso = new Date(baseMs + day * MS_DAY).toISOString().slice(0, 10);
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
                <Path key={a.id} d={a.d} stroke={a.critical ? colors.danger : colors.textMuted} strokeWidth={1.25} fill="none" opacity={draggingId && (a.from === draggingId || a.to === draggingId) ? 0 : 0.65} />
              ))}
            </Svg>
            {/* bars (hold ~220ms then drag horizontally to reschedule) */}
            {rows.map((r, i) => {
              if (r.kind !== 'task') return <View key={`pg-${i}`} style={{ height: ROW_H }} />;
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
                  chartW={timelineW}
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
  segBtnActive: { backgroundColor: t.accent },
  segText: { fontSize: 12, fontWeight: '700' as const, color: t.textMuted },
  segTextActive: { color: '#FFFFFF' },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: t.line, backgroundColor: t.surfaceAlt },
  chipActive: { backgroundColor: t.accent, borderColor: t.accent },
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
  barText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' as const },
  barTextOutside: { color: t.textSecondary, fontSize: 10, fontWeight: '700' as const, maxWidth: OUTSIDE_LABEL_MAX_W },
  barTextOutsideLeft: { position: 'absolute' as const, textAlign: 'right' as const },
  barTextOutsideDone: { color: t.textMuted, textDecorationLine: 'line-through' as const },
});
