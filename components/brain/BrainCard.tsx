// components/brain/BrainCard.tsx
//
// The canonical "MAGE Brain" surface. One branded card, used everywhere the
// Brain shows its work — the estimator confidence readout, the invoice payment
// predictor, the bid ranker, the project hub tile. Extracted verbatim from the
// estimate-wizard reference (the treatment the founder signed off on) so every
// screen speaks with ONE voice, ONE name, and ONE mark (MageAIMark).
//
// Presentational only — callers compute the copy (the `ground` line, the
// `lead`) and pass a 0–100 `confidence`. The card owns the look: the amber-spark
// mark, the "MAGE Brain" label, the confidence pill + meter (color-graded by
// level), and the signature accent left-rail.
//
//   Estimator / ranker:  <BrainCard confidence={68} ground="Priced with your
//                          cost history · 5 learned rates" lead="Answer 3
//                          questions below to sharpen the number" />
//   Header-only (hub):   <BrainCard ground="3 jobs need your attention today" />
//                          (omit `confidence` → no pill/meter, just the mark)

import React from 'react';
import { View, Text, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { MageAIMark } from '@/components/icons';

export interface BrainCardProps {
  /** 0–100. When provided, renders the confidence pill + meter. Omit for a
   *  header-only Brain card (just the mark + label + ground line). */
  confidence?: number;
  /** Header label. Defaults to the canonical "MAGE Brain". */
  label?: string;
  /** The grounding / explanation line under the meter — what the Brain based
   *  this on (cost history, market averages, days-to-pay, etc.). */
  ground?: string;
  /** Optional accent call-to-action line (e.g. "Answer 3 questions to sharpen"). */
  lead?: string;
  /** Extra content rendered inside the card, below the standard rows. */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Grade the confidence into the same three bands the reference used:
 *  ≥80 success (green), ≥60 accent (brand), else warning. */
function confidenceColor(conf: number, t: ReturnType<typeof useTheme>['colors']): string {
  return conf >= 80 ? t.success : conf >= 60 ? t.accent : t.warningLabel;
}

export function BrainCard({ confidence, label = 'MAGE Brain', ground, lead, children, style, testID }: BrainCardProps) {
  const { colors: t } = useTheme();
  const hasConf = typeof confidence === 'number' && Number.isFinite(confidence);
  const conf = hasConf ? Math.max(0, Math.min(100, Math.round(confidence as number))) : 0;
  const confColor = confidenceColor(conf, t);

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        { backgroundColor: t.surface, borderColor: t.line, borderLeftColor: t.accent },
        style,
      ]}
    >
      <View style={styles.top}>
        <MageAIMark size={16} color={t.accent} />
        <Text style={[styles.name, { color: t.text }]}>{label}</Text>
        {hasConf ? (
          <View style={[styles.pill, { backgroundColor: confColor + '1F' }]}>
            <Text style={[styles.pillText, { color: confColor }]}>{conf}% confident</Text>
          </View>
        ) : null}
      </View>
      {hasConf ? (
        <View style={[styles.track, { backgroundColor: t.surfaceAlt }]}>
          <View style={[styles.fill, { width: `${Math.max(4, conf)}%`, backgroundColor: confColor }]} />
        </View>
      ) : null}
      {ground ? <Text style={[styles.ground, { color: t.textSecondary }]}>{ground}</Text> : null}
      {lead ? <Text style={[styles.lead, { color: t.accent }]}>{lead}</Text> : null}
      {children}
    </View>
  );
}

/** BrainBadge — the minimal "this is the Brain" marker: the mark + the name,
 *  for section headers and list rows where a full card is too heavy. Keeps the
 *  name+icon pairing identical to BrainCard so they read as one system. */
export function BrainBadge({ label = 'MAGE Brain', color, style }: { label?: string; color?: string; style?: StyleProp<ViewStyle> }) {
  const { colors: t } = useTheme();
  const tint = color ?? t.accent;
  return (
    <View style={[styles.badge, style]}>
      <MageAIMark size={14} color={tint} />
      <Text style={[styles.badgeText, { color: tint }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderLeftWidth: 2,
    borderRadius: Tokens.radius.card,
    padding: 14,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  name: { fontSize: Type.footnote.fontSize, fontWeight: '800', flex: 1 },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { fontSize: Type.caption1.fontSize, fontWeight: '800' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  ground: { fontSize: Type.caption1.fontSize, marginTop: 9 },
  lead: { fontSize: Type.caption1.fontSize, fontWeight: '700', marginTop: 6 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeText: { fontSize: Type.caption1.fontSize, fontWeight: '800', letterSpacing: 0.2 },
});
