import React, { useCallback, useMemo, useRef } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet, Platform,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { CheckCircle2, CircleDot, Circle, ChevronDown, ChevronRight, Plus, Check, Trash2, RotateCcw } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import { getPhaseColor } from '@/utils/scheduleEngine';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { parseCalendarDay } from '@/utils/calendarDate';
import { taskCalendarRange } from '@/utils/scheduleOps';

interface MobileScheduleListProps {
  tasks: ScheduleTask[];
  startDate: string; // ISO yyyy-mm-dd
  /** Schedule calendar — startDay is a WORKING-day number, so the row dates
   *  depend on which days are worked (ProjectSchedule.workingDaysPerWeek /
   *  nonWorkingDates). Defaults to the app-wide 5-day week. */
  workingDaysPerWeek?: number;
  nonWorkingDates?: string[];
  collapsedPhases: Record<string, boolean>;
  onTogglePhase: (phase: string) => void;
  onPressTask: (task: ScheduleTask) => void;
  onAddTask: () => void;
  onUpdateTask: (task: ScheduleTask) => void;
  onDeleteTask: (id: string) => void;
}

/**
 * One flattened list row.
 *
 * The list is phase-grouped, but a nested "group -> card -> rows" tree cannot
 * be windowed by a FlatList, so the groups are flattened into a single row
 * stream: a 'phase' row followed by its 'task' rows (omitted entirely when the
 * phase is collapsed). `isFirstInPhase` / `isLastInPhase` carry the chrome the
 * old wrapping `card` View used to provide — see `rows` and the styles below.
 */
type ListRow =
  | {
      kind: 'phase';
      key: string;
      phase: string;
      color: string;
      taskCount: number;
      pct: number;
      collapsed: boolean;
      /** First phase gets no top gap; the rest reproduce `group`'s 16pt. */
      isFirst: boolean;
    }
  | {
      kind: 'task';
      key: string;
      task: ScheduleTask;
      /** Phase color, resolved once per phase instead of once per row. */
      color: string;
      isFirstInPhase: boolean;
      isLastInPhase: boolean;
    };

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
//
// This is the primary iOS schedule surface (app.json sets
// ios.supportsTablet: false, and ScheduleTabRoute sends phones to
// MobileScheduleScreen), so it is the list a superintendent actually opens.
// It used to be a plain ScrollView mapping every phase and, inside each, every
// task — so a full import mounted all of them synchronously before the first
// frame. The schedule importer's hard cap is the realistic worst case:
// MAX_ROWS = 1000 in supabase/functions/import-schedule/index.ts, and every
// row carries a Swipeable, a lucide status icon, three Texts and a progress
// track. Rows are now flattened into ONE stream and windowed by a FlatList
// that OWNS the scroll axis — nesting a VirtualizedList inside a same-axis
// ScrollView does not help, because RN hands it unbounded height and it mounts
// every row anyway.
export function MobileScheduleList({
  tasks, startDate, workingDaysPerWeek, nonWorkingDates, collapsedPhases, onTogglePhase, onPressTask, onAddTask, onUpdateTask, onDeleteTask,
}: MobileScheduleListProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // parseCalendarDay, NOT new Date(). `startDate` is a bare 'YYYY-MM-DD', which
  // the spec parses as UTC MIDNIGHT — so at any negative UTC offset
  // startOfDayMs floored it to the PREVIOUS local day and every date in this
  // list rendered one day early. Reproduced in America/New_York: with
  // startDate '2026-09-01' and a task on day 1, this list printed "Aug 31"
  // while TaskDetailSheet printed "Sep 1" for the SAME task.
  //
  // MobileGantt, TaskDetailSheet and SchedulerHeader were all corrected for
  // this on 2026-09-02; this file was missed because
  // scripts/validate-schedule-date-basis.ts named those three explicitly and
  // had never heard of the primary iOS list surface. That scope hole is now
  // closed in the guard as well.
  const base = useMemo(() => {
    const d = parseCalendarDay(startDate) ?? new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, [startDate]);

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

  // Phase headers + their task rows in one windowable stream. A collapsed
  // phase emits its header and nothing else, exactly as the old tree did.
  const rows = useMemo<ListRow[]>(() => {
    const out: ListRow[] = [];
    let isFirst = true;
    for (const ph of phases) {
      const collapsed = !!collapsedPhases[ph.phase];
      const color = getPhaseColor(ph.phase);
      out.push({
        kind: 'phase', key: `phase:${ph.phase}`, phase: ph.phase, color,
        taskCount: ph.tasks.length, pct: ph.pct, collapsed, isFirst,
      });
      isFirst = false;
      if (collapsed) continue;
      const last = ph.tasks.length - 1;
      for (let i = 0; i <= last; i++) {
        out.push({
          kind: 'task', key: `task:${ph.tasks[i].id}`, task: ph.tasks[i], color,
          isFirstInPhase: i === 0, isLastInPhase: i === last,
        });
      }
    }
    return out;
  }, [phases, collapsedPhases]);

  const markDone = useCallback((t: ScheduleTask) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    const nowDone = t.status === 'done';
    onUpdateTask({ ...t, status: nowDone ? 'in_progress' : 'done', progress: nowDone ? (t.progress ?? 0) : 100 });
  }, [onUpdateTask]);
  const confirmDelete = useCallback((t: ScheduleTask) => {
    showAlert('Delete task?', `"${t.title}" will be removed from the schedule.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); onDeleteTask(t.id); } },
    ]);
  }, [onDeleteTask]);

  const keyExtractor = useCallback((row: ListRow) => row.key, []);

  const renderRow = useCallback(({ item }: { item: ListRow }) => {
    if (item.kind === 'phase') {
      return (
        <TouchableOpacity
          style={[styles.phead, item.isFirst ? null : styles.pheadSpaced]}
          activeOpacity={0.7}
          onPress={() => onTogglePhase(item.phase)}
        >
          {item.collapsed ? <ChevronRight size={16} color={colors.textMuted} strokeWidth={1.75} /> : <ChevronDown size={16} color={colors.textMuted} strokeWidth={1.75} />}
          <View style={[styles.dot, { backgroundColor: item.color }]} />
          <Text style={styles.pname} numberOfLines={1}>{item.phase}</Text>
          <Text style={styles.ptasks}>{item.taskCount}</Text>
          <Text style={[styles.ppct, { color: item.color }]}>{item.pct}%</Text>
        </TouchableOpacity>
      );
    }
    const t = item.task;
    const color = item.color;
    // Milestones are 0-day events — show them as such. The
    // project-detail modal already prints 0d; clamping to 1d
    // here made the two surfaces contradict (sim-audit #2).
    const isMilestone = !!t.isMilestone || (t.durationDays || 0) === 0;
    const dur = Math.max(1, t.durationDays || 1);
    // startDay is 1-indexed (day 1 = schedule start) and counts WORKING days,
    // matching the desktop + CPM engine — so the dates are walked with
    // taskCalendarRange (addWorkingDays + site closures), the same resolver
    // the desktop grid and CSV use. This used to be `baseMs + offset * MS_DAY`
    // (B4 review A9 / item 2): a startDay-6 task on a Monday anchor printed
    // the Saturday, and after the 2026-11-01 fall-back every label sat a
    // day early because the 25-hour day floors to 23:00 the day before.
    const { start, end } = taskCalendarRange(t, base, workingDaysPerWeek, nonWorkingDates);
    const done = t.status === 'done';
    const crit = !!t.isCriticalPath && !done;
    const pct = Math.min(100, t.progress ?? 0);
    const range = fmt(start) === fmt(end) ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
    const crew = (t.crew || t.assignedSubName || '').trim();
    return (
      <View style={[styles.card, item.isFirstInPhase ? styles.cardTop : null, item.isLastInPhase ? styles.cardBottom : null]}>
        <SwipeRow done={done} onDone={() => markDone(t)} onDelete={() => confirmDelete(t)}>
          <TouchableOpacity style={[styles.row, item.isFirstInPhase ? null : styles.rowDivider]} activeOpacity={0.7} onPress={() => onPressTask(t)}>
            {crit && <View style={[styles.critEdge, { backgroundColor: colors.danger }]} />}
            {/* Status icons speak the app-wide STATUS language
                (done=success, in-progress=info, idle=muted) —
                not the phase palette (sim-audit slop #5). */}
            {done
              ? <CheckCircle2 size={18} color={colors.success} strokeWidth={1.75} />
              : t.status === 'in_progress'
                ? <CircleDot size={18} color={colors.info} strokeWidth={1.75} />
                : <Circle size={18} color={colors.textMuted} strokeWidth={1.75} />}
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.titleRow}>
                <Text style={[styles.tname, done ? styles.tnameDone : null]} numberOfLines={1}>{t.title}</Text>
                <Text style={styles.tpct}>{pct}%</Text>
              </View>
              <Text style={styles.tmeta} numberOfLines={1}>{range} · {isMilestone ? 0 : dur}d{crew ? ` · ${crew}` : ''}</Text>
              <View style={styles.track}><View style={[styles.fill, { width: `${pct}%`, backgroundColor: done ? colors.textMuted : color }]} /></View>
            </View>
          </TouchableOpacity>
        </SwipeRow>
      </View>
    );
  }, [styles, colors, base, workingDaysPerWeek, nonWorkingDates, onTogglePhase, onPressTask, markDone, confirmDelete]);

  const footer = (
    <TouchableOpacity
      style={[styles.addRow, rows.length > 0 ? styles.addRowSpaced : null]}
      activeOpacity={0.7}
      onPress={onAddTask}
      testID="mobile-list-add"
    >
      <Plus size={16} color={colors.accent} strokeWidth={1.75} />
      <Text style={styles.addText}>New Work Package</Text>
    </TouchableOpacity>
  );

  return (
    <FlatList
      style={{ flex: 1 }}
      data={rows}
      keyExtractor={keyExtractor}
      renderItem={renderRow}
      extraData={renderRow}
      ListFooterComponent={footer}
      contentContainerStyle={{ padding: 14, paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      testID="mobile-schedule-list"
    />
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  phead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 6, paddingHorizontal: 2 },
  // Phase groups used to be a `group` View ({ marginBottom: 16 }) wrapping the
  // header + its card. Flattened, a row cannot inherit a parent's margin — so
  // the 16pt between groups is a top margin on every phase header except the
  // first, and the same 16pt before the "New Work Package" footer. Rendered
  // spacing is unchanged.
  pheadSpaced: { marginTop: 16 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  pname: { flex: 1, fontSize: 14, fontWeight: '800' as const, color: t.text },
  ptasks: { fontSize: 11, fontWeight: '700' as const, color: t.textMuted, marginRight: 8 },
  ppct: { fontSize: 13, fontWeight: '800' as const, width: 44, textAlign: 'right' as const },
  // The rounded, bordered card used to wrap a whole phase's rows
  // ({ backgroundColor, borderRadius: lg, borderWidth: 1, overflow: 'hidden' }).
  // Each row now carries its own slice of that chrome: side borders always,
  // the top border + top corners on the phase's first row, the bottom border +
  // bottom corners on its last. Border counts are identical — the card's 1pt
  // top edge is cardTop, the 1pt dividers are still `rowDivider` on every row
  // after the first, and the 1pt bottom edge is cardBottom.
  card: { backgroundColor: t.surface, borderColor: t.line, borderLeftWidth: 1, borderRightWidth: 1 },
  cardTop: { borderTopWidth: 1, borderTopLeftRadius: Tokens.radius.lg, borderTopRightRadius: Tokens.radius.lg, overflow: 'hidden' as const },
  cardBottom: { borderBottomWidth: 1, borderBottomLeftRadius: Tokens.radius.lg, borderBottomRightRadius: Tokens.radius.lg, overflow: 'hidden' as const },
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
  addRowSpaced: { marginTop: 16 },
  addText: { fontSize: 13, fontWeight: '700' as const, color: t.accent },
  swipeActions: { flexDirection: 'row' as const },
  swipeBtn: { width: 76, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 3 },
  swipeTxt: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' as const },
});
