// components/schedule/SchedulerHeader.tsx — Phase 27.
//
// Renders the project title, status pill, KPI strip, and view/baseline
// pickers at the top of the scheduler. Same across all tabs.
//
// Reads context for tasks/cpm/viewScale. The progress donut is an SVG
// conic gradient via react-native-svg (already in deps).
//
// Phone fallback (bp === 'phone') compresses to a vertical layout:
//   title row → status + finish + slip subtitle → horizontal KPI chip rail.
// The view/baseline pickers move into a `⋯` overflow path (Task 18 keeps
// them visible elsewhere — the chip rail is the primary scan target on
// phone; pickers stay accessible from the More tab on the bottom bar).

import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { StatusPill } from './StatusPill';
import { useScheduler, type ViewScale } from './SchedulerContext';
import { computePillStatus } from '@/utils/scheduleHealth';
import { useResponsive } from '@/utils/useResponsive';

export interface SchedulerHeaderProps {
  projectName: string;
  onExportPress: () => void;
  onBaselinePress: () => void;
  /** Inline "+ Add Task" button rendered between VIEW and Export. */
  onAddTaskPress?: () => void;
}

export function SchedulerHeader({
  projectName,
  onExportPress,
  onBaselinePress,
  onAddTaskPress,
}: SchedulerHeaderProps) {
  useTheme();
  const { bp } = useResponsive();
  const { tasks, cpm, schedule, viewScale, setViewScale } = useScheduler();

  // KPI derivations
  const total = tasks.length;
  const completed = tasks.filter(t => t.status === 'done').length;
  const overdueCount = tasks.filter(t => {
    if (t.status === 'done') return false;
    if (!t.deadline) return false;
    return new Date(t.deadline).getTime() < Date.now();
  }).length;

  const progress = total > 0
    ? Math.round(tasks.reduce((s, t) => s + (t.progress ?? 0), 0) / total)
    : 0;

  const startDate = schedule.startDate
    ? new Date(schedule.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
  const totalDuration = schedule.totalDurationDays ?? 0;
  const finishDate = schedule.startDate
    ? new Date(new Date(schedule.startDate).getTime() + totalDuration * 86400000)
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  const pillStatus = computePillStatus({
    cpmSlipDays: cpm.slipDaysVsBaseline ?? 0,
    overdueCount,
    healthScore: schedule.healthScore ?? 100,
  });

  if (bp === 'phone') {
    const slipLabel = cpm.slipDaysVsBaseline == null
      ? 'no baseline'
      : cpm.slipDaysVsBaseline > 0
      ? `+${cpm.slipDaysVsBaseline}d slip`
      : cpm.slipDaysVsBaseline < 0
      ? `${cpm.slipDaysVsBaseline}d ahead`
      : 'on baseline';
    return (
      <View style={styles.phoneRoot}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{projectName}</Text>
          <Pressable onPress={onExportPress} style={styles.phoneExportBtn} hitSlop={8}>
            <Text style={styles.phoneExportBtnText}>⤓ Export</Text>
          </Pressable>
        </View>
        <View style={styles.phoneMeta}>
          <StatusPill status={pillStatus} />
          <Text style={styles.subtitle}>{finishDate} · {slipLabel}</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.phoneChipRail}
          contentContainerStyle={styles.phoneChipRailContent}
        >
          <KpiChip label="Progress" value={`${progress}%`} />
          <KpiChip label="Duration" value={`${totalDuration}d`} />
          <KpiChip label="Done" value={`${completed}/${total}`} color={Colors.pillOnTrack} />
          <KpiChip
            label="Overdue"
            value={String(overdueCount)}
            color={overdueCount > 0 ? Colors.pillLate : undefined}
          />
          <KpiChip label="Crit Path" value={`${cpm.criticalPathDays}d`} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={1}>{projectName}</Text>
        <StatusPill status={pillStatus} />
      </View>
      <Text style={styles.subtitle}>
        {startDate} — {finishDate} · {totalDuration} days · {total} tasks
      </Text>

      <View style={styles.kpiStrip}>
        <Kpi label="START"     value={startDate} />
        <Kpi label="FINISH"    value={finishDate} />
        <Kpi label="DURATION"  value={`${totalDuration} days`} />
        <View style={styles.kpiWithDonut}>
          <Kpi label="PROGRESS" value={`${progress}%`} />
          <ProgressDonut percent={progress} />
        </View>
        <Kpi label="TASKS"     value={String(total)} />
        <Kpi label="OVERDUE"   value={String(overdueCount)} color={overdueCount > 0 ? Colors.pillLate : undefined} />
        <Kpi label="COMPLETED" value={String(completed)} />

        <View style={styles.spacer} />

        <View style={styles.pickerGroup}>
          <Text style={styles.kpiLabel}>BASELINE</Text>
          <Pressable onPress={onBaselinePress} style={styles.picker} hitSlop={8}>
            <Text style={styles.pickerText}>Current ▾</Text>
          </Pressable>
        </View>
        <View style={styles.pickerGroup}>
          <Text style={styles.kpiLabel}>VIEW</Text>
          <ViewScalePicker value={viewScale} onChange={setViewScale} />
        </View>
        {onAddTaskPress ? (
          <Pressable onPress={onAddTaskPress} style={styles.addTaskBtn} hitSlop={8}>
            <Text style={styles.addTaskBtnText}>＋ Add Task</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onExportPress} style={styles.exportBtn} hitSlop={8}>
          <Text style={styles.exportBtnText}>⤓ Export</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={[styles.kpiValue, color ? { color } : undefined]}>{value}</Text>
    </View>
  );
}

function KpiChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label.toUpperCase()}</Text>
      <Text style={[styles.chipValue, color ? { color } : undefined]}>{value}</Text>
    </View>
  );
}

const VIEW_SCALE_ORDER: ReadonlyArray<ViewScale> = ['days', 'weeks', 'months'];

function ViewScalePicker({ value, onChange }: { value: ViewScale; onChange: (s: ViewScale) => void }) {
  const next = (): ViewScale => {
    const idx = VIEW_SCALE_ORDER.indexOf(value);
    return VIEW_SCALE_ORDER[(idx + 1) % VIEW_SCALE_ORDER.length];
  };
  return (
    <Pressable onPress={() => onChange(next())} style={styles.picker} hitSlop={8}>
      <Text style={styles.pickerText}>{value.charAt(0).toUpperCase() + value.slice(1)} ▾</Text>
    </Pressable>
  );
}

function ProgressDonut({ percent }: { percent: number }) {
  const size = 32;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const safePct = Math.max(0, Math.min(100, percent));
  const offset = circ - (safePct / 100) * circ;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={Colors.fillTertiary} strokeWidth={stroke} fill="none" />
          <Circle
            cx={size / 2} cy={size / 2} r={r}
            stroke={Colors.tradeColors.general}
            strokeWidth={stroke} fill="none"
            strokeDasharray={`${circ} ${circ}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: Colors.text, letterSpacing: -0.3, flex: 1 },
  subtitle: { fontSize: 11, color: Colors.textSecondary, marginTop: 4 },
  kpiStrip: { flexDirection: 'row', alignItems: 'flex-end', gap: 24, marginTop: 14, flexWrap: 'wrap' },
  kpi: { gap: 2 },
  kpiLabel: { fontSize: 9, color: Colors.textSecondary, letterSpacing: 0.8, fontWeight: '700' },
  kpiValue: { fontSize: 14, color: Colors.text, fontWeight: '600' },
  kpiWithDonut: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  spacer: { flex: 1 },
  pickerGroup: { gap: 4 },
  picker: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: Colors.surfaceAlt, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border },
  pickerText: { fontSize: 11, color: Colors.text, fontWeight: '500' },
  exportBtn: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.tradeColors.general, borderRadius: 8, alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center' },
  exportBtnText: { fontSize: 11, color: '#0B0D10', fontWeight: '700' },

  // Add Task — same shape/size as Export so the two read as a pair.
  // Slightly different fill (surfaceAlt + accent border) so the visual
  // weight matches Export without competing with it.
  addTaskBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.tradeColors.general,
    alignSelf: 'flex-end',
    minHeight: 44,
    justifyContent: 'center',
  },
  addTaskBtnText: {
    fontSize: 11,
    color: Colors.tradeColors.general,
    fontWeight: '700',
  },

  // ---- Phone layout ----
  phoneRoot: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  phoneMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  phoneChipRail: { marginTop: 10 },
  phoneChipRailContent: { paddingRight: 6 },
  phoneExportBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: Colors.tradeColors.general,
    borderRadius: 8,
    minHeight: 32,
    justifyContent: 'center',
  },
  phoneExportBtnText: { fontSize: 11, color: '#0B0D10', fontWeight: '700' },
  chip: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 7,
    marginRight: 6,
    minWidth: 74,
  },
  chipLabel: { fontSize: 8, color: Colors.textSecondary, letterSpacing: 0.5, fontWeight: '700' },
  chipValue: { fontSize: 13, color: Colors.text, fontWeight: '700', marginTop: 2 },
});
