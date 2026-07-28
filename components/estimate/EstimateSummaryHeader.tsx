// components/estimate/EstimateSummaryHeader.tsx
//
// The redesigned estimate summary: a 2×2 metric grid + an ESTIMATE SUMMARY
// card with a markup donut. Built on the approved ink+amber direction
// (docs/design/estimate-redesign) using the shared tokens — orange is the one
// accent (grand total), category/metric tiles use the trade-adjacent tones,
// no purple. Presentational only: all numbers are passed in.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { FileText, DollarSign, Percent, Package } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { IconWrapper, type IconWrapperTone } from '@/components/ui/IconWrapper';

interface Props {
  /** Direct cost (base, pre-markup). */
  directCost: number;
  /** Markup dollars. */
  markups: number;
  /** Optional contingency dollars; when omitted the 4th card shows item count. */
  contingency?: number;
  /** Line-item count (shown when contingency is omitted). */
  itemCount: number;
}

function money(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function EstimateSummaryHeader({ directCost, markups, contingency, itemCount }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const totalEstimate = directCost + markups + (contingency ?? 0);
  // "X% markup" label reads markup against direct cost (industry convention);
  // the donut ARC is markup's share of the marked-up subtotal.
  const markupPctLabel = directCost > 0 ? (markups / directCost) * 100 : 0;
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

  const fourth = contingency !== undefined
    ? { label: 'Contingency', value: money(contingency), sub: 'Reserve', icon: Package as typeof FileText, tone: 'info' as IconWrapperTone }
    : { label: 'Line Items', value: String(itemCount), sub: itemCount === 1 ? 'item' : 'items', icon: Package as typeof FileText, tone: 'neutral' as IconWrapperTone };

  const metrics: { label: string; value: string; sub: string; icon: typeof FileText; tone: IconWrapperTone }[] = [
    { label: 'Total Estimate', value: money(totalEstimate), sub: 'Including markups', icon: FileText, tone: 'accent' },
    { label: 'Total Cost', value: money(directCost), sub: 'Direct costs', icon: DollarSign, tone: 'success' },
    { label: 'Total Markups', value: money(markups), sub: `${markupPctLabel.toFixed(2)}% of direct`, icon: Percent, tone: 'warning' },
    fourth,
  ];

  return (
    <View>
      <View style={styles.grid}>
        {metrics.map((m) => (
          <View key={m.label} style={styles.metric}>
            <IconWrapper icon={m.icon} tone={m.tone} size="md" />
            <Text style={styles.metricLabel}>{m.label.toUpperCase()}</Text>
            <Text style={styles.metricValue}>{m.value}</Text>
            <Text style={styles.metricSub}>{m.sub}</Text>
          </View>
        ))}
      </View>

      <View style={styles.summary}>
        <View style={styles.summaryLeft}>
          <Text style={styles.summaryLabel}>ESTIMATE SUMMARY</Text>
          <View style={styles.sumRow}><Text style={styles.sumK}>Total Cost</Text><Text style={styles.sumV}>{money(directCost)}</Text></View>
          <View style={styles.sumRow}><Text style={styles.sumK}>Total Markups</Text><Text style={styles.sumV}>{money(markups)}</Text></View>
          {contingency !== undefined && (
            <View style={styles.sumRow}><Text style={styles.sumK}>Contingency</Text><Text style={styles.sumV}>{money(contingency)}</Text></View>
          )}
          <View style={styles.sumDivider} />
          <View style={styles.sumGrand}>
            <Text style={styles.sumGrandK}>GRAND TOTAL</Text>
            <Text style={styles.sumGrandV}>{money(totalEstimate)}</Text>
          </View>
        </View>
        <View style={styles.summaryRight}>
          <View style={styles.donutWrap}>
            <Svg width={104} height={104} viewBox="0 0 104 104">
              <Circle cx={52} cy={52} r={R} stroke={colors.surfaceAlt} strokeWidth={14} fill="none" />
              <Circle cx={52} cy={52} r={R} stroke={colors.textMuted} strokeWidth={14} fill="none"
                strokeDasharray={directDash} strokeDashoffset={0} transform="rotate(-90 52 52)" />
              <Circle cx={52} cy={52} r={R} stroke={colors.accent} strokeWidth={14} fill="none"
                strokeDasharray={markupDash} strokeDashoffset={markupOffset} transform="rotate(-90 52 52)" />
            </Svg>
            <View style={styles.donutCenter}>
              <Text style={styles.donutPct}>{markupPctLabel.toFixed(1)}%</Text>
              <Text style={styles.donutLbl}>Markup</Text>
            </View>
          </View>
          <View style={styles.legend}>
            <View style={styles.legendRow}><View style={[styles.dot, { backgroundColor: colors.accent }]} /><Text style={styles.legendK}>Markup</Text></View>
            <View style={styles.legendRow}><View style={[styles.dot, { backgroundColor: colors.textMuted }]} /><Text style={styles.legendK}>Direct Cost</Text></View>
          </View>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: {
    width: '47.8%', flexGrow: 1,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.card, padding: 13,
  },
  metricLabel: { fontSize: 9.5, letterSpacing: 0.7, color: t.textMuted, fontWeight: '700', marginTop: 11, marginBottom: 4 },
  metricValue: { fontSize: 20, fontWeight: '800', color: t.text, letterSpacing: -0.3 },
  metricSub: { fontSize: 11, color: t.textSecondary, marginTop: 3 },

  summary: {
    flexDirection: 'row', marginTop: 12,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.card,
    overflow: 'hidden',
  },
  summaryLeft: { flex: 1.25, padding: 14 },
  summaryRight: { flex: 1, padding: 14, borderLeftWidth: 1, borderLeftColor: t.line, alignItems: 'center', justifyContent: 'center' },
  summaryLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, color: t.text, marginBottom: 12 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  sumK: { fontSize: 12.5, color: t.textSecondary },
  sumV: { fontSize: 12.5, color: t.text, fontWeight: '600' },
  sumDivider: { height: 1, backgroundColor: t.line, marginVertical: 9 },
  sumGrand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sumGrandK: { fontSize: 12.5, fontWeight: '800', color: t.text },
  sumGrandV: { fontSize: 21, fontWeight: '800', color: t.accent, letterSpacing: -0.4 },

  donutWrap: { width: 104, height: 104, alignItems: 'center', justifyContent: 'center' },
  donutCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  donutPct: { fontSize: 17, fontWeight: '800', color: t.text, letterSpacing: -0.3 },
  donutLbl: { fontSize: 10, color: t.textSecondary },
  legend: { marginTop: 12, alignSelf: 'stretch', gap: 4 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendK: { fontSize: 11, color: t.textSecondary },
});
