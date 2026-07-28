// components/estimate/EstimateSummaryCard.tsx
//
// The ESTIMATE SUMMARY card: cost/markup/contingency rows, grand total, and a
// markup donut. Used inline on mobile and in the right rail on desktop.
// Presentational.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';

interface Props {
  directCost: number;
  markups: number;
  contingency?: number;
}

function money(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function EstimateSummaryCard({ directCost, markups, contingency }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const total = directCost + markups + (contingency ?? 0);
  const markupPct = directCost > 0 ? (markups / directCost) * 100 : 0;
  const subtotal = directCost + markups;
  const arcFraction = subtotal > 0 ? markups / subtotal : 0;

  const R = 44;
  const C = 2 * Math.PI * R;
  const markupLen = C * arcFraction;
  const { markupDash, directDash, markupOffset } = useMemo(() => ({
    markupDash: `${markupLen} ${C - markupLen}`,
    directDash: `${C - markupLen} ${markupLen}`,
    markupOffset: -(C - markupLen),
  }), [markupLen, C]);

  return (
    <View style={styles.card}>
      <Text style={styles.label}>ESTIMATE SUMMARY</Text>
      <View style={styles.row}><Text style={styles.k}>Total Cost</Text><Text style={styles.v}>{money(directCost)}</Text></View>
      <View style={styles.row}><Text style={styles.k}>Total Markups</Text><Text style={styles.v}>{money(markups)}</Text></View>
      {contingency !== undefined && (
        <View style={styles.row}><Text style={styles.k}>Contingency</Text><Text style={styles.v}>{money(contingency)}</Text></View>
      )}
      <View style={styles.divider} />
      <View style={styles.grand}>
        <Text style={styles.grandK}>GRAND TOTAL</Text>
        <Text style={styles.grandV}>{money(total)}</Text>
      </View>

      <View style={styles.donutWrap}>
        <View style={styles.donut}>
          <Svg width={104} height={104} viewBox="0 0 104 104">
            <Circle cx={52} cy={52} r={R} stroke={colors.surfaceAlt} strokeWidth={14} fill="none" />
            <Circle cx={52} cy={52} r={R} stroke={colors.textMuted} strokeWidth={14} fill="none"
              strokeDasharray={directDash} strokeDashoffset={0} transform="rotate(-90 52 52)" />
            <Circle cx={52} cy={52} r={R} stroke={colors.accent} strokeWidth={14} fill="none"
              strokeDasharray={markupDash} strokeDashoffset={markupOffset} transform="rotate(-90 52 52)" />
          </Svg>
          <View style={styles.donutCenter}>
            <Text style={styles.donutPct}>{markupPct.toFixed(1)}%</Text>
            <Text style={styles.donutLbl}>Markup</Text>
          </View>
        </View>
        <View style={styles.legend}>
          <View style={styles.legendRow}><View style={[styles.dot, { backgroundColor: colors.accent }]} /><Text style={styles.legendK}>Markup</Text><Text style={styles.legendV}>{money(markups)}</Text></View>
          <View style={styles.legendRow}><View style={[styles.dot, { backgroundColor: colors.textMuted }]} /><Text style={styles.legendK}>Direct Cost</Text><Text style={styles.legendV}>{money(directCost)}</Text></View>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.card, padding: 15 },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, color: t.text, marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  k: { fontSize: 12.5, color: t.textSecondary },
  v: { fontSize: 12.5, color: t.text, fontWeight: '600' },
  divider: { height: 1, backgroundColor: t.line, marginVertical: 9 },
  grand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grandK: { fontSize: 12.5, fontWeight: '800', color: t.text },
  grandV: { fontSize: 21, fontWeight: '800', color: t.accent, letterSpacing: -0.4 },

  donutWrap: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: t.line },
  donut: { width: 104, height: 104, alignItems: 'center', justifyContent: 'center' },
  donutCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  donutPct: { fontSize: 17, fontWeight: '800', color: t.text, letterSpacing: -0.3 },
  donutLbl: { fontSize: 10, color: t.textSecondary },
  legend: { flex: 1, gap: 6 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendK: { fontSize: 11, color: t.textSecondary, flex: 1 },
  legendV: { fontSize: 11, color: t.text, fontWeight: '600' },
});
