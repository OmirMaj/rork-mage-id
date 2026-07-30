// components/CostTruthChip.tsx
//
// Cost Truth pill: how your learned rate for a trade+unit compares to the
// cross-contractor regional benchmark. Renders nothing until stats load; shows
// an honest "building · n of 5" until the k-anonymity floor is met.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Users } from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { compareToBenchmark, benchmarkLabel, type BenchmarkStats } from '@/utils/costTruth';

export function CostTruthChip({ stats, rate }: { stats: BenchmarkStats | null; rate: number }) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (!stats) return null; // not loaded yet — show nothing rather than a guess

  const c = compareToBenchmark(rate, stats);
  const color =
    c.verdict === 'above'
      ? Colors.warning
      : c.verdict === 'below'
        ? t.success
        : c.verdict === 'in_range'
          ? t.textSecondary
          : t.textMuted; // insufficient

  return (
    <View style={[styles.chip, { borderColor: color + '40', backgroundColor: color + '10' }]}>
      <Users size={11} color={color} strokeWidth={2} />
      <Text style={[styles.text, { color }]} numberOfLines={1}>
        {benchmarkLabel(c)}
      </Text>
    </View>
  );
}

const makeStyles = (_t: ThemeColors) =>
  StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      alignSelf: 'flex-start',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: Tokens.radius.full,
      borderWidth: 1,
    },
    text: { ...Type.caption2, fontWeight: '700' },
  });

export default CostTruthChip;
