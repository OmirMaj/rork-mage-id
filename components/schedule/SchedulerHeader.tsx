// components/schedule/SchedulerHeader.tsx — Phase 27.
//
// Renders the project title, status pill, KPI strip, and view/baseline
// pickers at the top of the scheduler. Same across all tabs.
//
// Reads context for tasks/cpm/viewScale. The progress donut is an SVG
// conic gradient via react-native-svg (already in deps).

import { View, Text, StyleSheet, Pressable } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { StatusPill } from './StatusPill';
import { useScheduler, type ViewScale } from './SchedulerContext';
import { computePillStatus } from '@/utils/scheduleHealth';

export interface SchedulerHeaderProps {
  projectName: string;
  onExportPress: () => void;
  onBaselinePress: () => void;
}

export function SchedulerHeader({ projectName, onExportPress, onBaselinePress }: SchedulerHeaderProps) {
  useTheme();
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
    cpmSlipDays: cpm.slipDaysVsBaseline,
    overdueCount,
    healthScore: schedule.healthScore ?? 100,
  });

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
  title: { fontSize: 22, fontWeight: '700', color: Colors.text, letterSpacing: -0.3 },
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
});
