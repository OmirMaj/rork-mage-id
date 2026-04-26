import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Path, Line, Circle } from 'react-native-svg';
import { TrendingUp, TrendingDown, ChevronRight, Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { CashFlowWeek } from '@/utils/cashFlowEngine';
import { formatMoney } from '@/utils/formatters';

interface Props {
  forecast: CashFlowWeek[] | null;
  weeks?: number;
}

// At-a-glance cash flow tile for the dashboard. Shows a sparkline of running
// balance for the next N weeks plus in/out/net totals. The full forecaster
// (drill-in) lives at /cash-flow.
export default function CashFlowGlance({ forecast, weeks = 4 }: Props) {
  const router = useRouter();
  const { width } = useWindowDimensions();

  // CRITICAL: every hook call lives ABOVE the early returns, otherwise
  // React sees different hook counts between renders ("rendered more
  // hooks than during the previous render").
  const slice = useMemo(
    () => (forecast ?? []).slice(0, weeks),
    [forecast, weeks],
  );
  const totals = useMemo(() => {
    return slice.reduce((acc, w) => ({
      income: acc.income + w.totalIncome,
      expense: acc.expense + w.totalExpenses,
    }), { income: 0, expense: 0 });
  }, [slice]);

  if (!forecast || forecast.length === 0) return null;
  if (slice.length < 2) return null;

  const net = totals.income - totals.expense;
  const balances = slice.map(w => w.runningBalance);
  const minBal = Math.min(...balances);
  const maxBal = Math.max(...balances);
  const range = maxBal - minBal || 1;
  const goesNegative = balances.some(b => b < 0);

  // Sparkline geometry — width auto-adjusts to viewport, height is fixed.
  const padX = 20;
  const padY = 14;
  const chartW = Math.max(180, Math.min(420, width - 80));
  const chartH = 64;
  const points = balances.map((b, i) => {
    const x = padX + (i / (balances.length - 1)) * (chartW - padX * 2);
    const y = padY + (1 - (b - minBal) / range) * (chartH - padY * 2);
    return { x, y };
  });
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const fillD = `${pathD} L${points[points.length - 1].x},${chartH} L${points[0].x},${chartH} Z`;
  const lineColor = goesNegative ? '#C0392B' : Colors.primary;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push('/cash-flow' as any)}
      activeOpacity={0.85}
    >
      <View style={styles.head}>
        <View style={styles.headIcon}>
          <Wallet size={16} color={Colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Cash flow · next {weeks} weeks</Text>
          <Text style={[styles.endingBalance, goesNegative && { color: '#C0392B' }]}>
            {formatMoney(balances[balances.length - 1])}
          </Text>
        </View>
        <ChevronRight size={16} color={Colors.textMuted} />
      </View>

      <Svg width={chartW} height={chartH} style={styles.spark}>
        <Line x1={padX} y1={chartH - padY} x2={chartW - padX} y2={chartH - padY} stroke={Colors.border} strokeWidth={1} strokeDasharray="2,3" />
        <Path d={fillD} fill={lineColor} fillOpacity={0.10} />
        <Path d={pathD} stroke={lineColor} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={i === points.length - 1 ? 3 : 2} fill={lineColor} />
        ))}
      </Svg>

      <View style={styles.foot}>
        <Stat label="In" value={formatMoney(totals.income)} icon={<TrendingUp size={12} color="#1E8E4A" />} />
        <Stat label="Out" value={formatMoney(totals.expense)} icon={<TrendingDown size={12} color="#C26A00" />} />
        <Stat
          label="Net"
          value={formatMoney(net)}
          accent={net >= 0 ? Colors.text : '#C0392B'}
        />
      </View>

      {goesNegative && (
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            Heads up — balance dips below zero in the next {weeks} weeks. Bill outstanding work or push expenses.
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function Stat({ label, value, icon, accent }: { label: string; value: string; icon?: React.ReactNode; accent?: string }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statHead}>
        {icon}
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={[styles.statValue, accent ? { color: accent } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  headIcon: {
    width: 30, height: 30, borderRadius: 9,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  eyebrow: {
    fontSize: 11, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 0.6, textTransform: 'uppercase',
    marginBottom: 2,
  },
  endingBalance: { fontSize: 22, fontWeight: '800', color: Colors.text },
  spark: { alignSelf: 'center', marginVertical: 6 },
  foot: {
    flexDirection: 'row',
    paddingTop: 10,
    borderTopWidth: 1, borderTopColor: Colors.border,
    marginTop: 4, gap: 8,
  },
  stat: { flex: 1 },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  statLabel: {
    fontSize: 10, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  statValue: { fontSize: 14, fontWeight: '700', color: Colors.text },
  warning: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#FBEAE7',
  },
  warningText: { fontSize: 12, color: '#7A1B12', lineHeight: 16, fontWeight: '600' },
});
