// ============================================================================
// components/PipelineHeroChart.tsx
//
// Hero chart card for the home tab. Mirrors the "Monthly Recurring Revenue"
// element in the SaaS-dashboard reference the user shared — a big confident
// number, a delta chip, and a line chart taking up most of the card.
//
// Domain mapping for MAGE ID: instead of MRR, we plot CUMULATIVE PROJECT
// VALUE BOOKED over the last N months. Each project contributes its
// grandTotal (linkedEstimate.grandTotal preferred over legacy estimate) at
// its createdAt month. The line shows momentum — a flat stretch reads as a
// stalled pipeline, a steep rise reads as a winning streak. Delta is
// last-30d net add vs prior-30d net add.
//
// Renders nothing when there are zero projects with a value. Caller is
// responsible for the empty-state UI in that case.
// ============================================================================

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Line as SvgLine, Circle } from 'react-native-svg';
import { TrendingUp, TrendingDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { formatMoney, formatMoneyShort } from '@/utils/formatters';
import type { Project } from '@/types';

interface Props {
  projects: Project[];
}

const MONTHS_BACK = 9;
const CHART_HEIGHT = 160;

function projectValue(p: Project): number {
  if (p.linkedEstimate?.grandTotal) return p.linkedEstimate.grandTotal;
  if (p.estimate?.grandTotal) return p.estimate.grandTotal;
  return 0;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

const PipelineHeroChart = React.memo(function PipelineHeroChart({ projects }: Props) {
  const data = useMemo(() => {
    const now = new Date();
    const months: { date: Date; label: string }[] = [];
    for (let i = MONTHS_BACK - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        date: d,
        label: d.toLocaleDateString('en-US', { month: 'short' }),
      });
    }

    // Cumulative booked value at the END of each month — count any project
    // whose createdAt month is <= that month's start.
    const points = months.map(m => {
      const cutoff = new Date(m.date.getFullYear(), m.date.getMonth() + 1, 0).getTime();
      const total = projects.reduce((sum, p) => {
        const created = Date.parse(p.createdAt);
        if (!Number.isFinite(created) || created > cutoff) return sum;
        return sum + projectValue(p);
      }, 0);
      return { x: m.label, y: total };
    });

    const totalCurrent = points[points.length - 1]?.y ?? 0;

    // Delta: last 30d net add vs prior 30d net add. Reads as "this month
    // booked $X more than last month" rather than absolute diff.
    const cutoffNow = now.getTime();
    const cutoff30 = cutoffNow - 30 * 24 * 60 * 60 * 1000;
    const cutoff60 = cutoffNow - 60 * 24 * 60 * 60 * 1000;
    let last30 = 0;
    let prior30 = 0;
    for (const p of projects) {
      const created = Date.parse(p.createdAt);
      const v = projectValue(p);
      if (!Number.isFinite(created)) continue;
      if (created > cutoff30) last30 += v;
      else if (created > cutoff60) prior30 += v;
    }
    const delta = last30 - prior30;

    return { points, totalCurrent, delta, last30 };
  }, [projects]);

  const screenWidth = Dimensions.get('window').width;
  // Card padding + sidebar offset budget. Caller can override by wrapping
  // in a sized container; we cap to a sensible max so super-wide desktops
  // don't get a weirdly stretched chart.
  const chartW = Math.min(screenWidth - 80, 760);
  const chartH = CHART_HEIGHT;
  const padX = 8;
  const padY = 16;

  const hasData = data.totalCurrent > 0;

  const { path, areaPath, dotXY } = useMemo(() => {
    if (!hasData || data.points.length === 0) {
      return { path: '', areaPath: '', dotXY: null as { x: number; y: number } | null };
    }
    const maxY = Math.max(...data.points.map(p => p.y), 1);
    const innerW = chartW - padX * 2;
    const innerH = chartH - padY * 2;

    const toX = (i: number) => padX + (i / Math.max(1, data.points.length - 1)) * innerW;
    const toY = (v: number) => padY + (1 - v / maxY) * innerH;

    const segs = data.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.y).toFixed(1)}`);
    const linePath = segs.join(' ');

    const lastIdx = data.points.length - 1;
    const lastX = toX(lastIdx);
    const lastY = toY(data.points[lastIdx].y);

    const area = `${linePath} L ${lastX.toFixed(1)} ${(padY + innerH).toFixed(1)} L ${toX(0).toFixed(1)} ${(padY + innerH).toFixed(1)} Z`;

    return { path: linePath, areaPath: area, dotXY: { x: lastX, y: lastY } };
  }, [data.points, hasData, chartW, chartH]);

  if (!hasData) return null;

  const deltaPositive = data.delta >= 0;
  const DeltaIcon = deltaPositive ? TrendingUp : TrendingDown;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={styles.eyebrow}>Pipeline value</Text>
          <View style={styles.amountRow}>
            <Text style={styles.amount}>{formatMoney(data.totalCurrent)}</Text>
            {data.delta !== 0 && (
              <View style={[
                styles.deltaPill,
                { backgroundColor: deltaPositive ? Colors.successLight : Colors.errorLight },
              ]}>
                <DeltaIcon size={11} color={deltaPositive ? Colors.success : Colors.error} strokeWidth={2.4} />
                <Text style={[
                  styles.deltaText,
                  { color: deltaPositive ? Colors.success : Colors.error },
                ]}>
                  {deltaPositive ? '+' : '-'}{formatMoneyShort(Math.abs(data.delta))}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.subline}>
            Booked across {projects.length} project{projects.length === 1 ? '' : 's'} · last {MONTHS_BACK} months
          </Text>
        </View>
      </View>

      <View style={styles.chartWrap}>
        <Svg width={chartW} height={chartH}>
          <Defs>
            <LinearGradient id="pipeline-fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={Colors.primary} stopOpacity="0.18" />
              <Stop offset="100%" stopColor={Colors.primary} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          {/* Subtle gridline at the bottom — gives the line something to sit on */}
          <SvgLine
            x1={padX}
            y1={chartH - padY}
            x2={chartW - padX}
            y2={chartH - padY}
            stroke="rgba(60,60,67,0.08)"
            strokeWidth={1}
          />
          {areaPath ? <Path d={areaPath} fill="url(#pipeline-fill)" /> : null}
          {path ? (
            <Path
              d={path}
              stroke={Colors.primary}
              strokeWidth={2.5}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
          {dotXY ? (
            <>
              <Circle cx={dotXY.x} cy={dotXY.y} r={6} fill={Colors.surface} />
              <Circle cx={dotXY.x} cy={dotXY.y} r={4} fill={Colors.primary} />
            </>
          ) : null}
        </Svg>
        <View style={styles.xAxis}>
          {data.points.map((p, i) => (
            <Text key={i} style={styles.xLabel}>{p.x}</Text>
          ))}
        </View>
      </View>
    </View>
  );
});

export default PipelineHeroChart;

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginBottom: 24,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  eyebrow: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
    letterSpacing: 0.2,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  amount: {
    fontSize: Type.title1.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.6,
  },
  deltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  deltaText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    letterSpacing: -0.1,
  },
  subline: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
    marginTop: 2,
  },
  chartWrap: {
    marginTop: 4,
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: 4,
  },
  xLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500' as const,
    letterSpacing: 0.3,
  },
});
