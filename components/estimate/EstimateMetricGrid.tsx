// components/estimate/EstimateMetricGrid.tsx
//
// The 2×2 (mobile) / 4-across (desktop) metric cards: Total Estimate, Total
// Cost, Total Markups, and Contingency-or-Items. Ink+amber tiles from the
// trade-adjacent tones (no purple). Presentational.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FileText, DollarSign, Percent, Package } from 'lucide-react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { IconWrapper, type IconWrapperTone } from '@/components/ui/IconWrapper';

export interface MetricGridProps {
  directCost: number;
  markups: number;
  contingency?: number;
  itemCount: number;
  /** 4-across row when true (desktop), 2×2 otherwise. */
  wide?: boolean;
}

function money(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function EstimateMetricGrid({ directCost, markups, contingency, itemCount, wide }: MetricGridProps) {
  const styles = useThemedStyles(makeStyles);
  const totalEstimate = directCost + markups + (contingency ?? 0);
  const markupPct = directCost > 0 ? (markups / directCost) * 100 : 0;

  const fourth = contingency !== undefined
    ? { label: 'Contingency', value: money(contingency), sub: 'Reserve', icon: Package, tone: 'info' as IconWrapperTone }
    : { label: 'Line Items', value: String(itemCount), sub: itemCount === 1 ? 'item' : 'items', icon: Package, tone: 'neutral' as IconWrapperTone };

  const metrics: { label: string; value: string; sub: string; icon: typeof FileText; tone: IconWrapperTone }[] = [
    { label: 'Total Estimate', value: money(totalEstimate), sub: 'Including markups', icon: FileText, tone: 'accent' },
    { label: 'Total Cost', value: money(directCost), sub: 'Direct costs', icon: DollarSign, tone: 'success' },
    { label: 'Total Markups', value: money(markups), sub: `${markupPct.toFixed(2)}% of direct`, icon: Percent, tone: 'warning' },
    fourth,
  ];

  return (
    <View style={styles.grid}>
      {metrics.map((m) => (
        <View key={m.label} style={[styles.metric, wide ? styles.metricWide : styles.metricHalf]}>
          <IconWrapper icon={m.icon} tone={m.tone} size="md" />
          <Text style={styles.metricLabel}>{m.label.toUpperCase()}</Text>
          <Text style={styles.metricValue}>{m.value}</Text>
          <Text style={styles.metricSub}>{m.sub}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.card, padding: 13 },
  metricHalf: { width: '47.8%', flexGrow: 1 },
  metricWide: { flex: 1, minWidth: 180 },
  metricLabel: { fontSize: 9.5, letterSpacing: 0.7, color: t.textMuted, fontWeight: '700', marginTop: 11, marginBottom: 4 },
  metricValue: { fontSize: 20, fontWeight: '800', color: t.text, letterSpacing: -0.3 },
  metricSub: { fontSize: 11, color: t.textSecondary, marginTop: 3 },
});
