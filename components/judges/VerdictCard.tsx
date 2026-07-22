// VerdictCard — the JUDGES result surface. Renders the already-computed
// BidVerdict + AI narration from a JudgesResult: a color-coded verdict pill,
// the recommended bid range, true cost / margin, the narration paragraph, a
// cost-confidence badge, the ranked drivers (capped at 5), and any
// disclaimers. Every figure is pre-computed by the pure engine — this file
// only phrases and colors them.
//
// Theming mirrors app/cost-xray.tsx: useTheme() + useThemedStyles(makeStyles),
// Type.* tokens, Tokens.radius.*, semantic ThemeColors — no raw hex, no inline
// fontSize, no numeric borderRadius. Verdict colors use the semantic names
// cost-xray uses: success (take), accentHot (hold firm), danger (walk).
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Colors } from '@/constants/colors';
import type { Verdict } from '@/utils/judges/types';
import type { JudgesResult } from '@/utils/judges/runJudges';
import { BidDriverRow } from './BidDriverRow';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const VERDICT_LABEL: Record<Verdict, string> = {
  take: 'Take it',
  hold_firm: 'Bid but hold firm',
  walk: 'Walk away',
};

const CONFIDENCE_LABEL = { low: 'Low', medium: 'Medium', high: 'High' } as const;

/** Whole-dollar money, no cents. */
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function VerdictCard({ result }: { result: JudgesResult }) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { verdict: v, narration } = result;

  // take → success green, hold_firm → hot amber, walk → danger red.
  const verdictColor =
    v.verdict === 'take' ? t.success : v.verdict === 'hold_firm' ? t.accentHot : t.danger;

  const drivers = v.drivers.slice(0, 5);

  return (
    <View style={styles.card}>
      {/* Verdict pill + fit score */}
      <View style={styles.pillRow}>
        <View style={[styles.pill, { backgroundColor: verdictColor }]}>
          <Text style={styles.pillText}>{VERDICT_LABEL[v.verdict]}</Text>
        </View>
        <Text style={styles.fitScore}>{v.fitScore}/100</Text>
      </View>

      {/* Recommended range */}
      <Text style={styles.rangeLabel}>Recommended bid</Text>
      <Text style={styles.range}>
        {money(v.recommendedLow)}–{money(v.recommendedHigh)}
      </Text>
      <Text style={styles.rangeSub}>
        True cost {money(v.trueCost)} · {Math.round(v.marginAtMid * 100)}% margin at {money(v.recommendedMid)}
      </Text>

      {/* Narration */}
      {narration ? <Text style={styles.narration}>{narration}</Text> : null}

      {/* Confidence badge */}
      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {CONFIDENCE_LABEL[v.costConfidence]} confidence · {Math.round(v.coveragePct * 100)}% from your history
          </Text>
        </View>
      </View>

      {/* Drivers */}
      {drivers.length > 0 && (
        <View style={styles.driversWrap}>
          <Text style={styles.sectionLabel}>Why</Text>
          {drivers.map((d, i) => (
            <BidDriverRow key={`${d.kind}-${i}`} driver={d} />
          ))}
        </View>
      )}

      {/* Disclaimers */}
      {v.disclaimers.length > 0 && (
        <View style={styles.disclaimersWrap}>
          {v.disclaimers.map((s, i) => (
            <Text key={i} style={styles.disclaimer}>{s}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

export default VerdictCard;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: t.line,
    padding: 16,
    gap: 6,
  },

  pillRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 6,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: Tokens.radius.full,
  },
  pillText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: Colors.textOnAccent,
  },
  fitScore: {
    fontSize: Type.title3.fontSize,
    fontWeight: '800' as const,
    color: t.text,
  },

  rangeLabel: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    fontWeight: '600' as const,
    letterSpacing: 0.4,
  },
  range: {
    fontSize: Type.title1.fontSize,
    fontWeight: '800' as const,
    color: t.text,
  },
  rangeSub: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
    marginTop: 1,
  },

  narration: {
    fontSize: Type.body.fontSize,
    lineHeight: Type.body.lineHeight,
    color: t.text,
    marginTop: 10,
  },

  badgeRow: { flexDirection: 'row' as const, marginTop: 10 },
  badge: {
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: t.line,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    fontWeight: '600' as const,
  },

  driversWrap: { marginTop: 12 },
  sectionLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    marginBottom: 2,
  },

  disclaimersWrap: {
    marginTop: 10,
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: t.line,
    paddingTop: 10,
  },
  disclaimer: {
    fontSize: Type.caption1.fontSize,
    lineHeight: 17,
    color: t.textMuted,
  },
});
