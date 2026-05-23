import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { CheckCircle2, CircleDot, Circle, Plus, ChevronDown, ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import { getPhaseColor } from '@/utils/scheduleEngine';
import { orthogonalArrowPath } from '@/utils/ganttArrowPath';

interface MobileGanttProps {
  tasks: ScheduleTask[];
  startDate: string; // ISO yyyy-mm-dd
  selectedDate: Date;
  collapsedPhases: Record<string, boolean>;
  onTogglePhase: (phase: string) => void;
  onPressTask: (task: ScheduleTask) => void;
  onAddTask: () => void;
}

const DAY_W = 26;
const ROW_H = 40;
const HEADER_H = 44;
const LEFT_W = 150;
const MS_DAY = 24 * 60 * 60 * 1000;

type Row =
  | { kind: 'phase'; phase: string; pct: number }
  | { kind: 'task'; task: ScheduleTask };

function startOfDayMs(d: Date): number { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }

export function MobileGantt({
  tasks, startDate, selectedDate, collapsedPhases, onTogglePhase, onPressTask, onAddTask,
}: MobileGanttProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const baseMs = useMemo(() => startOfDayMs(startDate ? new Date(startDate) : new Date()), [startDate]);
  const todayIdx = Math.round((startOfDayMs(new Date()) - baseMs) / MS_DAY);

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

  const maxDay = useMemo(() => tasks.reduce((m, t) => Math.max(m, (t.startDay ?? 0) + Math.max(1, t.durationDays || 1)), 7), [tasks]);
  const numDays = maxDay + 2;
  const timelineW = numDays * DAY_W;
  const contentH = HEADER_H + rows.length * ROW_H;

  // Bar geometry per task id (for arrows).
  const barById = useMemo(() => {
    const m = new Map<string, { x: number; w: number; yMid: number }>();
    rows.forEach((r, i) => {
      if (r.kind !== 'task') return;
      const x = (r.task.startDay ?? 0) * DAY_W;
      const w = Math.max(DAY_W * 0.6, Math.max(1, r.task.durationDays || 1) * DAY_W - 3);
      m.set(r.task.id, { x, w, yMid: HEADER_H + i * ROW_H + ROW_H / 2 });
    });
    return m;
  }, [rows]);

  const arrows = useMemo(() => {
    const out: { id: string; d: string; critical: boolean }[] = [];
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
        out.push({ id: `${link.taskId}->${r.task.id}`, d, critical: crit });
      }
    });
    return out;
  }, [rows, barById]);

  const weekTicks = useMemo(() => {
    const ticks: { x: number; label: string }[] = [];
    for (let d = 0; d < numDays; d += 7) {
      const dt = new Date(baseMs + d * MS_DAY);
      ticks.push({ x: d * DAY_W, label: `${dt.getMonth() + 1}/${dt.getDate()}` });
    }
    return ticks;
  }, [numDays, baseMs]);

  return (
    <ScrollView style={styles.outer} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
      <View style={{ flexDirection: 'row' }}>
        {/* LEFT — frozen WBS column */}
        <View style={{ width: LEFT_W }}>
          <View style={{ height: HEADER_H, justifyContent: 'flex-end', paddingBottom: 6, paddingLeft: 12 }}>
            <Text style={styles.leftHdr}>WORK PACKAGES</Text>
          </View>
          {rows.map((r, i) => r.kind === 'phase' ? (
            <TouchableOpacity key={`p-${r.phase}`} style={[styles.lrow, styles.phaseRow]} activeOpacity={0.7} onPress={() => onTogglePhase(r.phase)}>
              {collapsedPhases[r.phase] ? <ChevronRight size={14} color={colors.textMuted} /> : <ChevronDown size={14} color={colors.textMuted} />}
              <View style={[styles.phaseDot, { backgroundColor: getPhaseColor(r.phase) }]} />
              <Text style={styles.phaseName} numberOfLines={1}>{r.phase}</Text>
              <Text style={styles.phasePct}>{r.pct}%</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity key={r.task.id} style={[styles.lrow, styles.taskRow]} activeOpacity={0.7} onPress={() => onPressTask(r.task)}>
              {r.task.status === 'done'
                ? <CheckCircle2 size={15} color={colors.success} />
                : r.task.status === 'in_progress'
                  ? <CircleDot size={15} color={getPhaseColor(r.task.phase || 'Other')} />
                  : <Circle size={15} color={colors.textMuted} />}
              <Text style={[styles.taskName, r.task.status === 'done' ? styles.taskNameDone : null]} numberOfLines={1}>{r.task.title}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.addRow} activeOpacity={0.7} onPress={onAddTask} testID="mobile-gantt-add">
            <Plus size={15} color={colors.accent} />
            <Text style={styles.addText}>New Work Package</Text>
          </TouchableOpacity>
        </View>

        {/* RIGHT — horizontally-scrollable timeline (vertical scroll handled by outer) */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ width: timelineW, height: contentH }}>
            {/* week ticks header */}
            <View style={{ height: HEADER_H }}>
              {weekTicks.map((t, i) => (
                <Text key={i} style={[styles.weekTick, { left: t.x + 4 }]}>{t.label}</Text>
              ))}
            </View>
            {/* today line */}
            {todayIdx >= 0 && todayIdx <= numDays && (
              <View style={[styles.todayLine, { left: todayIdx * DAY_W + DAY_W / 2, height: contentH }]} />
            )}
            {/* dependency arrows */}
            <Svg width={timelineW} height={contentH} style={StyleSheet.absoluteFill} pointerEvents="none">
              {arrows.map((a) => (
                <Path key={a.id} d={a.d} stroke={a.critical ? colors.danger : colors.textMuted} strokeWidth={1.25} fill="none" opacity={0.65} />
              ))}
            </Svg>
            {/* bars */}
            {rows.map((r, i) => {
              if (r.kind !== 'task') return <View key={`pg-${i}`} style={{ height: ROW_H }} />;
              const g = barById.get(r.task.id)!;
              const done = r.task.status === 'done';
              // Red is reserved for ACTIVE critical work; a completed task isn't
              // "at risk", so done bars use the (de-emphasized) phase color.
              const color = !done && r.task.isCriticalPath ? colors.danger : getPhaseColor(r.task.phase || 'Other');
              return (
                <TouchableOpacity
                  key={r.task.id}
                  activeOpacity={0.8}
                  onPress={() => onPressTask(r.task)}
                  style={[styles.bar, { left: g.x, width: g.w, top: HEADER_H + i * ROW_H + (ROW_H - 22) / 2, backgroundColor: color, opacity: done ? 0.5 : 1 }]}
                >
                  {g.w > 46 && (
                    <Text style={styles.barText} numberOfLines={1}>
                      {done ? '✓ ' : ''}{r.task.title}
                    </Text>
                  )}
                </TouchableOpacity>
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
  bar: { position: 'absolute' as const, height: 22, borderRadius: 6, justifyContent: 'center' as const, paddingHorizontal: 7 },
  barText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' as const },
});
