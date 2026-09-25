// components/logs/RecordContextStrip.tsx — one read-only line of facts at the
// top of a log's record pane (wave 6c, lane G). DESKTOP WEB ONLY (it mounts
// inside LogShell).
//
//   RFI        status · ball in court · due / days overdue · days open · priority
//   Submittal  status · cycle n · required · lead days
//   CO         status · approvals x/y · ±amount · schedule days
//   Invoice    status · balance · aging · QBO
//
// It replaces the wave-6 audit's 280 px context rail: at 1512 the record pane
// is 730 px, and a 280 rail inside it would leave the form about 450. The rail
// is deferred. An unknown fact reads '—', never 0.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Layout } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { StatusPill, type StatusTone } from '@/components/ui/StatusPill';

export interface ContextFact {
  label: string;
  /** null → '—' (unknown, never 0). */
  value: string | null;
  /** 'danger' for an overdue fact. */
  tone?: 'danger';
}

export interface RecordContextStripProps {
  status: { label: string; tone: StatusTone } | null;
  facts: readonly ContextFact[];
  testID?: string;
}

export function RecordContextStrip({ status, facts, testID }: RecordContextStripProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.strip} testID={testID} accessibilityRole="summary">
      {status ? <StatusPill label={status.label} tone={status.tone} size="compact" /> : null}
      {facts.map((f) => (
        <View key={f.label} style={styles.fact}>
          <Text style={styles.label}>{f.label}</Text>
          <Text style={[styles.value, f.tone === 'danger' && { color: t.dangerLabel }]} numberOfLines={1}>
            {f.value ?? '—'}
          </Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: Layout.groupGap,
    rowGap: 6,
    paddingHorizontal: Layout.cardPad,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
    backgroundColor: t.surface,
  },
  fact: { flexDirection: 'row', alignItems: 'baseline', gap: 6, maxWidth: Layout.field.sm },
  label: { ...Type.caption1, color: t.textSecondary },
  value: { ...Type.footnoteEmphasized, color: t.text, fontVariant: ['tabular-nums'], flexShrink: 1 },
});

export default RecordContextStrip;
