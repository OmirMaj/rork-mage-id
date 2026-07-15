import React, { useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, Platform } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { CheckCircle2, CircleDot, Circle, ChevronDown, ChevronRight, Plus, Check, Trash2, RotateCcw } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import { getPhaseColor } from '@/utils/scheduleEngine';
import { Tokens } from '@/constants/designTokens';

interface MobileScheduleListProps {
  tasks: ScheduleTask[];
  startDate: string; // ISO yyyy-mm-dd
  collapsedPhases: Record<string, boolean>;
  onTogglePhase: (phase: string) => void;
  onPressTask: (task: ScheduleTask) => void;
  onAddTask: () => void;
  onUpdateTask: (task: ScheduleTask) => void;
  onDeleteTask: (id: string) => void;
}

const MS_DAY = 24 * 60 * 60 * 1000;

function startOfDayMs(d: Date): number { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
function fmt(d: Date): string { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

function weighted(ts: ScheduleTask[]): number {
  const dur = ts.reduce((s, t) => s + Math.max(1, t.durationDays || 1), 0);
  if (dur === 0) return 0;
  return Math.round(ts.reduce((s, t) => s + (t.progress || 0) * Math.max(1, t.durationDays || 1), 0) / dur);
}

// One swipeable task row. Swipe left → Done/Undo + Delete. Holds its own
// Swipeable ref so it can close after an action fires.
function SwipeRow({ done, onDone, onDelete, children }: { done: boolean; onDone: () => void; onDelete: () => void; children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const ref = useRef<Swipeable>(null);
  const renderRight = () => (
    <View style={styles.swipeActions}>
      <TouchableOpacity
        style={[styles.swipeBtn, { backgroundColor: colors.success }]}
        onPress={() => { ref.current?.close(); onDone(); }}
      >
        {done ? <RotateCcw size={17} color="#FFFFFF" strokeWidth={1.75} /> : <Check size={18} color="#FFFFFF" strokeWidth={1.75} />}
        <Text style={styles.swipeTxt}>{done ? 'Undo' : 'Done'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.swipeBtn, { backgroundColor: colors.danger }]}
        onPress={() => { ref.current?.close(); onDelete(); }}
      >
        <Trash2 size={17} color="#FFFFFF" strokeWidth={1.75} />
        <Text style={styles.swipeTxt}>Delete</Text>
      </TouchableOpacity>
    </View>
  );
  return <Swipeable ref={ref} renderRightActions={renderRight} overshootRight={false} friction={1.6}>{children}</Swipeable>;
}

// Mobile-readable schedule: a vertical, single-direction list grouped by phase.
// Companion to MobileGantt (the horizontal timeline), toggled from
// MobileScheduleScreen. Swipe a row for quick Done / Delete.
export function MobileScheduleList({
  tasks, startDate, collapsedPhases, onTogglePhase, onPressTask, onAddTask, onUpdateTask, onDeleteTask,
}: MobileScheduleListProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const baseMs = useMemo(() => startOfDayMs(startDate ? new Date(startDate) : new Date()), [startDate]);

  const phases = useMemo(() => {
    const order: string[] = [];
    const by = new Map<string, ScheduleTask[]>();
    for (const t of tasks) {
      const p = t.phase || 'Other';
      if (!by.has(p)) { by.set(p, []); order.push(p); }
      by.get(p)!.push(t);
    }
    return order.map((p) => ({ phase: p, tasks: by.get(p)!, pct: weighted(by.get(p)!) }));
  }, [tasks]);

  const markDone = (t: ScheduleTask) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    const nowDone = t.status === 'done';
    onUpdateTask({ ...t, status: nowDone ? 'in_progress' : 'done', progress: nowDone ? (t.progress ?? 0) : 100 });
  };
  const confirmDelete = (t: ScheduleTask) => {
    Alert.alert('Delete task?', `"${t.title}" will be removed from the schedule.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); onDeleteTask(t.id); } },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
      {phases.map((ph) => {
        const collapsed = collapsedPhases[ph.phase];
        const color = getPhaseColor(ph.phase);
        return (
          <View key={ph.phase} style={styles.group}>
            <TouchableOpacity style={styles.phead} activeOpacity={0.7} onPress={() => onTogglePhase(ph.phase)}>
              {collapsed ? <ChevronRight size={16} color={colors.textMuted} strokeWidth={1.75} /> : <ChevronDown size={16} color={colors.textMuted} strokeWidth={1.75} />}
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={styles.pname} numberOfLines={1}>{ph.phase}</Text>
              <Text style={styles.ptasks}>{ph.tasks.length}</Text>
              <Text style={[styles.ppct, { color }]}>{ph.pct}%</Text>
            </TouchableOpacity>
            {!collapsed && (
              <View style={styles.card}>
                {ph.tasks.map((t, i) => {
                  const dur = Math.max(1, t.durationDays || 1);
                  // startDay is 1-indexed (day 1 = schedule start), matching the
                  // desktop + CPM engine; shift by -1 to a 0-indexed day-offset.
                  const startOffset = (t.startDay ?? 1) - 1;
                  const start = new Date(baseMs + startOffset * MS_DAY);
                  const end = new Date(baseMs + (startOffset + dur - 1) * MS_DAY);
                  const done = t.status === 'done';
                  const crit = !!t.isCriticalPath && !done;
                  const pct = Math.min(100, t.progress ?? 0);
                  const range = fmt(start) === fmt(end) ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
                  const crew = (t.crew || t.assignedSubName || '').trim();
                  return (
                    <SwipeRow key={t.id} done={done} onDone={() => markDone(t)} onDelete={() => confirmDelete(t)}>
                      <TouchableOpacity style={[styles.row, i > 0 ? styles.rowDivider : null]} activeOpacity={0.7} onPress={() => onPressTask(t)}>
                        {crit && <View style={[styles.critEdge, { backgroundColor: colors.danger }]} />}
                        {done
                          ? <CheckCircle2 size={18} color={colors.success} strokeWidth={1.75} />
                          : t.status === 'in_progress'
                            ? <CircleDot size={18} color={color} strokeWidth={1.75} />
                            : <Circle size={18} color={colors.textMuted} strokeWidth={1.75} />}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={styles.titleRow}>
                            <Text style={[styles.tname, done ? styles.tnameDone : null]} numberOfLines={1}>{t.title}</Text>
                            <Text style={styles.tpct}>{pct}%</Text>
                          </View>
                          <Text style={styles.tmeta} numberOfLines={1}>{range} · {dur}d{crew ? ` · ${crew}` : ''}</Text>
                          <View style={styles.track}><View style={[styles.fill, { width: `${pct}%`, backgroundColor: done ? colors.textMuted : color }]} /></View>
                        </View>
                      </TouchableOpacity>
                    </SwipeRow>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
      <TouchableOpacity style={styles.addRow} activeOpacity={0.7} onPress={onAddTask} testID="mobile-list-add">
        <Plus size={16} color={colors.accent} strokeWidth={1.75} />
        <Text style={styles.addText}>New Work Package</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  group: { marginBottom: 16 },
  phead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 6, paddingHorizontal: 2 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  pname: { flex: 1, fontSize: 14, fontWeight: '800' as const, color: t.text },
  ptasks: { fontSize: 11, fontWeight: '700' as const, color: t.textMuted, marginRight: 8 },
  ppct: { fontSize: 13, fontWeight: '800' as const, width: 44, textAlign: 'right' as const },
  card: { backgroundColor: t.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line, overflow: 'hidden' as const },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 11, padding: 12, backgroundColor: t.surface },
  rowDivider: { borderTopWidth: 1, borderTopColor: t.line },
  critEdge: { position: 'absolute' as const, left: 0, top: 0, bottom: 0, width: 3 },
  titleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  tname: { flex: 1, fontSize: 14.5, fontWeight: '700' as const, color: t.text },
  tnameDone: { color: t.textMuted, textDecorationLine: 'line-through' as const },
  tpct: { fontSize: 12, fontWeight: '800' as const, color: t.textSecondary },
  tmeta: { fontSize: 12, fontWeight: '600' as const, color: t.textMuted, marginTop: 2 },
  track: { height: 5, backgroundColor: t.line, borderRadius: 3, overflow: 'hidden' as const, marginTop: 7 },
  fill: { height: '100%' as const, borderRadius: 3 },
  addRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 7, paddingVertical: 14 },
  addText: { fontSize: 13, fontWeight: '700' as const, color: t.accent },
  swipeActions: { flexDirection: 'row' as const },
  swipeBtn: { width: 76, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 3 },
  swipeTxt: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' as const },
});
