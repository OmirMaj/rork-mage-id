// components/schedule/tabs/DashboardTab.tsx — Phase 27.
//
// Project health at a glance: 4 KPI tiles, earned-value line chart,
// tasks-by-status donut, critical-path activities list.
//
// All metrics derive from existing data — no new schema. Health score
// is schedule.healthScore. CPI from existing earned-value calc (if
// the project has EV data; otherwise CPI cell shows "—").
//
// Phone fallback (bp === 'phone'): the 4 stat tiles wrap to 2x2 instead
// of a single 4-wide row, and the EV / status charts stack vertically.

import { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import { parseCalendarDay, formatCalendarDay, daysUntilCalendarDay } from '@/utils/calendarDate';
import { addWorkingDays } from '@/utils/scheduleEngine';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useScheduler } from '../SchedulerContext';
import { tradeKeyForTask, tradeLabel } from '@/utils/scheduleColors';
import { scheduleVerdict } from '@/utils/scheduleVerdict';
import { useResponsive } from '@/utils/useResponsive';

export function DashboardTab() {
  useTheme();
  const { bp } = useResponsive();
  const isPhone = bp === 'phone';
  const { tasks, schedule, cpm } = useScheduler();

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'done').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress' || t.status === 'on_hold').length;
    const notStarted = tasks.filter(t => t.status === 'not_started').length;
    // UX-F9: deadline is a bare calendar day (GridPane writes 'YYYY-MM-DD');
    // parsed as UTC midnight it read as overdue from ~6 pm the evening before.
    // A task is overdue once its deadline DAY is behind local today.
    const overdueTasks = tasks.filter(t =>
      t.status !== 'done' && t.deadline && (daysUntilCalendarDay(t.deadline) ?? 0) < 0
    );
    return {
      total, done, inProgress, notStarted,
      overdue: overdueTasks.length,
      overdueTaskName: overdueTasks[0]?.title,
    };
  }, [tasks]);

  const critical = tasks.filter(t => cpm.criticalTaskIds.includes(t.id));
  const healthScore = schedule.healthScore ?? 100;
  const healthColor = healthScore >= 80 ? Colors.pillOnTrack
                    : healthScore >= 60 ? Colors.pillAtRisk
                    : Colors.pillLate;

  // UX-F9: the same working-day walk as SchedulerHeader's FINISH KPI. The old
  // label added raw calendar milliseconds to a UTC-midnight anchor — no
  // weekends skipped, a fencepost long, and a day early west of Greenwich —
  // so it disagreed with the header two inches above it.
  const startAnchor = parseCalendarDay(schedule.startDate);
  const finishLabel = startAnchor
    ? addWorkingDays(startAnchor, Math.max(0, (schedule.totalDurationDays ?? 0) - 1), schedule.workingDaysPerWeek, schedule.nonWorkingDates)
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
  // The finish-date driver = the last critical-path task (the one that ends the project).
  const driverTitle = critical.length > 0 ? critical[critical.length - 1].title : undefined;
  const verdict = scheduleVerdict({
    slipDaysVsBaseline: cpm.slipDaysVsBaseline ?? null,
    finishDateLabel: finishLabel,
    criticalDriverTitle: driverTitle,
    overdueCount: stats.overdue,
  });
  const verdictColor = verdict.tone === 'behind' ? Colors.pillLate
                     : verdict.tone === 'slightlyBehind' ? Colors.pillAtRisk
                     : verdict.tone === 'ahead' || verdict.tone === 'onPace' ? Colors.pillOnTrack
                     : Colors.textSecondary;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* Plain-language verdict banner */}
      <View style={styles.verdictBanner}>
        <View style={[styles.verdictDot, { backgroundColor: verdictColor }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.verdictHeadline}>{verdict.headline}</Text>
          {verdict.detail ? <Text style={styles.verdictDetail}>{verdict.detail}</Text> : null}
        </View>
      </View>

      {/* Stat tiles — desktop: single 4-col row; phone: 2x2 wrap */}
      <View style={[styles.statRow, isPhone && styles.statRowPhone]}>
        <StatCard
          label="HEALTH SCORE"
          value={String(healthScore)}
          valueColor={healthColor}
          delta={cpm.slipDaysVsBaseline == null ? 'No baseline' : cpm.slipDaysVsBaseline === 0 ? 'On baseline' : `${cpm.slipDaysVsBaseline > 0 ? '↘' : '↑'} ${Math.abs(cpm.slipDaysVsBaseline)}d ${cpm.slipDaysVsBaseline > 0 ? 'slip' : 'ahead'}`}
          phone={isPhone}
        />
        <StatCard
          label="CRITICAL PATH"
          value={`${cpm.criticalPathDays}d`}
          delta={`${critical.length} task${critical.length === 1 ? '' : 's'}`}
          phone={isPhone}
        />
        <StatCard
          label="BUDGET"
          value="Not linked"
          delta="Link an estimate to track cost"
          phone={isPhone}
        />
        <StatCard
          label="OVERDUE"
          value={String(stats.overdue)}
          valueColor={stats.overdue > 0 ? Colors.pillLate : undefined}
          delta={stats.overdueTaskName ?? 'None'}
          deltaBad={stats.overdue > 0}
          phone={isPhone}
        />
      </View>

      {/* Charts row — desktop: side-by-side; phone: stacked */}
      <View style={[styles.chartsRow, isPhone && styles.chartsRowPhone]}>
        <View style={[styles.chartCard, isPhone ? styles.chartCardPhone : { flex: 1.4 }]}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>Earned Value</Text>
            <View style={styles.legend}>
              <Legend color={Colors.tradeColors.general} label="EV" />
              <Legend color={Colors.textSecondary} label="PV" />
              <Legend color={Colors.pillLate} label="AC" />
            </View>
          </View>
          {/* Real EV renders at the screen level (EarnedValuePanel) when a budget is linked. */}
          <View style={{ height: 140, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={styles.chartHint}>Link a budget to see earned value</Text>
          </View>
        </View>

        <View style={[styles.chartCard, isPhone ? styles.chartCardPhone : { flex: 1 }]}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>Tasks by Status</Text>
            <Text style={styles.chartHint}>{stats.total} total</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <StatusDonut
              done={stats.done}
              inProgress={stats.inProgress}
              notStarted={stats.notStarted}
              overdue={stats.overdue}
              total={stats.total}
            />
            <View>
              <LegendRow color={Colors.tradeColors.general} label="Done" count={stats.done} />
              <LegendRow color="#FFCC80" label="In Progress" count={stats.inProgress} />
              <LegendRow color={Colors.fillTertiary} label="Not Started" count={stats.notStarted} />
              {stats.overdue > 0 && <LegendRow color={Colors.pillLate} label="Overdue" count={stats.overdue} />}
            </View>
          </View>
        </View>
      </View>

      {/* Critical-path activities list */}
      <View style={styles.cpList}>
        <View style={styles.chartHeader}>
          <Text style={styles.chartTitle}>Critical Path Activities</Text>
          <Text style={styles.chartHint}>{critical.length} tasks · {cpm.criticalPathDays}d total</Text>
        </View>
        {critical.length === 0 && (
          <Text style={styles.emptyText}>No critical-path activities yet.</Text>
        )}
        {critical.map(t => (
          <View key={t.id} style={styles.cpRow}>
            <View style={styles.cpRowLeft}>
              <Text style={[styles.cpDot, { color: Colors.pillLate }]}>●</Text>
              <Text style={styles.cpName} numberOfLines={1}>{t.title}</Text>
              <Text style={styles.cpTrade}>{tradeLabel(tradeKeyForTask(t)).toUpperCase()}</Text>
            </View>
            <Text style={styles.cpFloat}>no buffer</Text>
            <Text style={styles.cpDue}>{t.deadline ? formatCalendarDay(t.deadline, { month: 'short', day: 'numeric' }) : '—'}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function StatCard({ label, value, valueColor, delta, deltaBad, phone }: { label: string; value: string; valueColor?: string; delta: string; deltaBad?: boolean; phone?: boolean }) {
  return (
    <View style={[styles.statCard, phone && styles.statCardPhone]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
      <Text style={[styles.statDelta, deltaBad ? { color: Colors.pillLate } : undefined]} numberOfLines={1}>{delta}</Text>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontSize: 10, color: Colors.textSecondary }}>{label}</Text>
    </View>
  );
}

function LegendRow({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 3 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontSize: 11, color: Colors.text }}>{label} · {count}</Text>
    </View>
  );
}

function StatusDonut({ done, inProgress, notStarted, overdue, total }: { done: number; inProgress: number; notStarted: number; overdue: number; total: number }) {
  const r = 40, stroke = 16, size = 120;
  const safeTotal = Math.max(total, 1);
  const segments = [
    { value: done, color: Colors.tradeColors.general },
    { value: inProgress, color: '#FFCC80' },
    { value: notStarted, color: Colors.fillTertiary },
    { value: overdue, color: Colors.pillLate },
  ].filter(s => s.value > 0);

  let cumulative = 0;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox={`-${size / 2} -${size / 2} ${size} ${size}`}>
        {segments.map((seg, i) => {
          const pct = (seg.value / safeTotal) * 100;
          const a0 = (cumulative / 100) * 2 * Math.PI - Math.PI / 2;
          const a1 = ((cumulative + pct) / 100) * 2 * Math.PI - Math.PI / 2;
          const large = pct > 50 ? 1 : 0;
          const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r;
          const x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r;
          cumulative += pct;
          // For a single 100% segment, just render a full circle
          if (segments.length === 1) {
            return <Circle key={i} cx={0} cy={0} r={r} stroke={seg.color} strokeWidth={stroke} fill="none" />;
          }
          return <Path key={i} d={`M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`} stroke={seg.color} strokeWidth={stroke} fill="none" />;
        })}
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text style={{ fontSize: 18, color: Colors.text, fontWeight: '700' }}>{Math.round((done / safeTotal) * 100)}%</Text>
        <Text style={{ fontSize: 9, color: Colors.textSecondary, letterSpacing: 0.6 }}>DONE</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 18, gap: 14 },
  verdictBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: Colors.surface, borderRadius: Tokens.radius.md, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border },
  verdictDot: { width: 10, height: 10, borderRadius: Tokens.radius.full, marginTop: 4 },
  verdictHeadline: { fontSize: Type.subheadline.fontSize, fontWeight: '700', color: Colors.text },
  verdictDetail: { fontSize: Type.footnote.fontSize, color: Colors.textSecondary, marginTop: 3 },
  statRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: 10, padding: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border,
  },
  statLabel: { fontSize: 10, color: Colors.textSecondary, letterSpacing: 0.6, fontWeight: '700' },
  statValue: { fontSize: 22, fontWeight: '700', color: Colors.text, letterSpacing: -0.4, marginTop: 6 },
  statDelta: { fontSize: 10, color: Colors.textSecondary, marginTop: 4 },
  chartsRow: { flexDirection: 'row', gap: 10 },
  chartCard: {
    backgroundColor: Colors.surface, borderRadius: 10, padding: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border,
  },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  chartTitle: { color: Colors.text, fontSize: 12, fontWeight: '600' },
  chartHint: { color: Colors.textSecondary, fontSize: 10 },
  legend: { flexDirection: 'row', gap: 14 },
  cpList: {
    backgroundColor: Colors.surface, borderRadius: 10, padding: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border,
  },
  cpRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(31,37,45,0.6)',
  },
  cpRowLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  cpDot: { fontSize: 10 },
  cpName: { color: Colors.text, fontSize: 11, flexShrink: 1 },
  cpTrade: { color: Colors.textSecondary, fontSize: 9, marginLeft: 4 },
  cpFloat: { width: 60, color: Colors.pillLate, fontSize: 11 },
  cpDue: { width: 50, color: Colors.textSecondary, fontSize: 11, textAlign: 'right' },
  emptyText: { color: Colors.textMuted, fontSize: 11, textAlign: 'center', paddingVertical: 14, fontStyle: 'italic' },

  // ---- Phone overrides (Task 18): 2x2 stat wrap + stacked charts ----
  statRowPhone: { flexWrap: 'wrap', gap: 10 },
  statCardPhone: {
    flex: 0,
    flexBasis: '47%',
    flexGrow: 1,
  },
  chartsRowPhone: { flexDirection: 'column', gap: 10 },
  chartCardPhone: { flex: 0 },
});
