// components/schedule/tabs/BoardTab.tsx — Phase 27.
//
// Kanban with 3 columns matching ScheduleTask.status enum:
// not_started / in_progress / done. Tap a card opens TaskInspector
// (selection wired via SchedulerContext). Drag-and-drop between
// columns is deferred — most mobile Kanbans use tap-to-edit-status.
//
// Each card: phase dot + phase label + task name + donut + due date +
// optional red "CP" badge for critical-path tasks.
//
// Phone fallback (bp === 'phone'): only one column is visible at a time;
// the user toggles via a status-tab strip at the top. iOS Kanban
// convention — desktop side-by-side is unreadable below 600px.

import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import { formatCalendarDay } from '@/utils/calendarDate';
import { useTheme } from '@/contexts/ThemeContext';
import { useScheduler } from '../SchedulerContext';
import { tradeKeyForTask, tradeLabel } from '@/utils/scheduleColors';
import { useResponsive } from '@/utils/useResponsive';
import type { ScheduleTask, TaskStatus } from '@/types';

const COLUMNS: { key: TaskStatus; title: string }[] = [
  { key: 'not_started', title: 'Not Started' },
  { key: 'in_progress', title: 'In Progress' },
  { key: 'done',        title: 'Done' },
];

export function BoardTab() {
  useTheme();
  const { bp } = useResponsive();
  const { tasks, cpm, setSelectedTaskId } = useScheduler();
  const [phoneCol, setPhoneCol] = useState<TaskStatus>('in_progress');

  const grouped = useMemo(() => {
    const map = new Map<TaskStatus, ScheduleTask[]>();
    COLUMNS.forEach(c => map.set(c.key, []));
    for (const t of tasks) {
      // 'on_hold' tasks treated as 'in_progress' for board display
      const colKey: TaskStatus = t.status === 'on_hold' ? 'in_progress' : t.status;
      const arr = map.get(colKey) ?? map.get('not_started');
      arr?.push(t);
    }
    return map;
  }, [tasks]);

  if (bp === 'phone') {
    const colTasks = grouped.get(phoneCol) ?? [];
    return (
      <View style={styles.phoneRoot}>
        <View style={styles.phoneColSwitcher}>
          {COLUMNS.map(c => {
            const isActive = phoneCol === c.key;
            const count = (grouped.get(c.key) ?? []).length;
            return (
              <Pressable
                key={c.key}
                onPress={() => setPhoneCol(c.key)}
                style={[styles.phoneSwitcherTab, isActive && styles.phoneSwitcherTabActive]}
                accessibilityRole="tab"
                accessibilityLabel={c.title}
                accessibilityState={{ selected: isActive }}
              >
                <Text style={[styles.phoneSwitcherLabel, isActive && styles.phoneSwitcherLabelActive]}>
                  {c.title}
                </Text>
                <Text style={[styles.phoneSwitcherCount, isActive && styles.phoneSwitcherCountActive]}>
                  {count}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <ScrollView style={styles.phoneCol} contentContainerStyle={styles.phoneColContent}>
          {colTasks.length === 0 && (
            <Text style={styles.emptyHint}>No tasks here yet.</Text>
          )}
          {colTasks.map(task => (
            <BoardCard
              key={task.id}
              task={task}
              isCritical={cpm.criticalTaskIds.includes(task.id)}
              onPress={() => setSelectedTaskId(task.id)}
            />
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {COLUMNS.map(col => {
        const colTasks = grouped.get(col.key) ?? [];
        return (
          <ScrollView
            key={col.key}
            style={styles.col}
            contentContainerStyle={styles.colContent}
          >
            <View style={styles.colHeader}>
              <Text style={styles.colTitle}>{col.title.toUpperCase()}</Text>
              <Text style={styles.colCount}>{colTasks.length}</Text>
            </View>
            {colTasks.map(task => (
              <BoardCard
                key={task.id}
                task={task}
                isCritical={cpm.criticalTaskIds.includes(task.id)}
                onPress={() => setSelectedTaskId(task.id)}
              />
            ))}
            {colTasks.length === 0 && (
              <Text style={styles.emptyHint}>No tasks here yet.</Text>
            )}
          </ScrollView>
        );
      })}
    </View>
  );
}

function BoardCard({
  task,
  isCritical,
  onPress,
}: {
  task: ScheduleTask;
  isCritical: boolean;
  onPress: () => void;
}) {
  const phase = tradeKeyForTask(task);
  const phaseColor = Colors.tradeColors[phase];
  const progress =
    task.status === 'done'
      ? 100
      : Math.max(0, Math.min(100, task.progress ?? 0));

  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.phaseDot, { backgroundColor: phaseColor }]} />
        <Text style={styles.phaseLabel}>{tradeLabel(phase).toUpperCase()}</Text>
      </View>
      <Text style={styles.cardName} numberOfLines={2}>
        {task.title}
      </Text>
      <View style={styles.cardMeta}>
        <CardDonut percent={progress} />
        <Text style={styles.cardDate}>{formatDate(task)}</Text>
        {isCritical && (
          <View style={styles.cpBadge}>
            <Text style={styles.cpBadgeText}>CP</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function CardDonut({ percent }: { percent: number }) {
  const size = 14;
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (percent / 100) * circ;
  const color =
    percent === 100 ? Colors.pillOnTrack : Colors.tradeColors.general;
  return (
    <Svg width={size} height={size}>
      <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={Colors.fillTertiary}
          strokeWidth={stroke}
          fill="none"
        />
        {percent > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${circ} ${circ}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        )}
      </G>
    </Svg>
  );
}

function formatDate(task: ScheduleTask): string {
  if (task.deadline) {
    // UX-F9: deadline is a bare calendar day (GridPane writes 'YYYY-MM-DD');
    // new Date() parsed it as UTC midnight, so the Board card showed the day
    // before the Grid's "Due by" anywhere west of Greenwich.
    return formatCalendarDay(task.deadline, { month: 'short', day: 'numeric' });
  }
  return `${task.durationDays ?? 0}d`;
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', padding: 10, gap: 10 },
  col: { flex: 1, backgroundColor: Colors.surfaceAlt, borderRadius: 8 },
  colContent: { padding: 10, gap: 8 },
  colHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    marginBottom: 4,
  },
  colTitle: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  colCount: { color: Colors.textSecondary, fontSize: 11 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 5,
  },
  phaseDot: { width: 7, height: 7, borderRadius: 4 },
  phaseLabel: {
    color: Colors.textSecondary,
    fontSize: 9,
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  cardName: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
    marginBottom: 8,
  },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardDate: { color: Colors.textSecondary, fontSize: 10 },
  cpBadge: {
    backgroundColor: Colors.pillLate,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 2,
  },
  cpBadgeText: {
    color: '#0B0D10',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  emptyHint: {
    color: Colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    paddingVertical: 20,
    fontStyle: 'italic',
  },

  // ---- Phone single-column layout (Task 18) ----
  phoneRoot: { flex: 1 },
  phoneColSwitcher: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  phoneSwitcherTab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 7,
    backgroundColor: Colors.surfaceAlt,
  },
  phoneSwitcherTabActive: {
    backgroundColor: Colors.tradeColors.general,
  },
  phoneSwitcherLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  phoneSwitcherLabelActive: {
    color: '#0B0D10',
    fontWeight: '700',
  },
  phoneSwitcherCount: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  phoneSwitcherCountActive: {
    color: '#0B0D10',
    fontWeight: '700',
  },
  phoneCol: { flex: 1, backgroundColor: Colors.surfaceAlt },
  phoneColContent: { padding: 12, gap: 8 },
});
