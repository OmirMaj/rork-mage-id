// components/estimate/EstimateCostBreakdown.tsx
//
// Right-rail "Cost Breakdown" — each CSI division as a share of the total,
// shown as a labeled bar. Colors match the division tiles (no purple).
// Presentational; percentages computed from the passed division totals.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import type { DivisionRow } from './EstimateDivisionTable';

const DIVISION_COLOR: Record<string, string> = {
  '01': '#FF6A1A', '02': '#66BB6A', '03': '#90A4AE', '04': '#4FC3F7',
  '05': '#FFA726', '06': '#8D6E63', '07': '#EF5350', '08': '#26C6DA',
  '09': '#5FBF6B', '22': '#26C6DA', '23': '#FFA726', '26': '#4FC3F7',
  '31': '#66BB6A', '32': '#66BB6A', '33': '#90A4AE', other: '#74838F',
};

export function EstimateCostBreakdown({ divisions }: { divisions: DivisionRow[] }) {
  const styles = useThemedStyles(makeStyles);

  const bars = useMemo(() => {
    const total = divisions.reduce((s, d) => s + d.total, 0);
    if (total <= 0) return [];
    return [...divisions]
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)
      .map(d => ({
        key: d.key,
        label: d.number ? `${d.number} ${d.title}` : d.title,
        pct: (d.total / total) * 100,
        color: DIVISION_COLOR[d.key] ?? '#74838F',
      }));
  }, [divisions]);

  if (bars.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.head}>COST BREAKDOWN</Text>
      {bars.map(b => (
        <View key={b.key} style={styles.bar}>
          <View style={styles.barTop}>
            <Text style={styles.barName} numberOfLines={1}>{b.label}</Text>
            <Text style={styles.barPct}>{b.pct.toFixed(1)}%</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.max(2, b.pct)}%`, backgroundColor: b.color }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.card, padding: 15 },
  head: { fontSize: 11, letterSpacing: 1, color: t.textMuted, fontWeight: '800', marginBottom: 13 },
  bar: { marginBottom: 10 },
  barTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  barName: { fontSize: 11.5, color: t.textSecondary, flex: 1, marginRight: 8 },
  barPct: { fontSize: 11.5, color: t.text, fontWeight: '600' },
  track: { height: 6, borderRadius: 3, backgroundColor: t.surfaceAlt, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
