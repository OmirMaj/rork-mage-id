// components/schedule/PaceChip.tsx — "Your pace: 9d (4 jobs)" suggestion chip.
//
// Rendered on schedule-review task cards when the pace book knows this trade
// at medium+ confidence AND disagrees with the AI's proposed duration by at
// least a day. Tapping applies the suggestion; it is never automatic, and
// low-confidence/no-history renders nothing (silence, not noise). The small
// dot signals confidence: accent = medium, success-green = high.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { History } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface PaceChipProps {
  suggestedDays: number;
  jobCount: number;
  confidence: 'medium' | 'high';
  onApply: () => void;
}

export default function PaceChip({ suggestedDays, jobCount, confidence, onApply }: PaceChipProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      style={styles.chip}
      onPress={onApply}
      activeOpacity={0.8}
      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={`Use your pace: ${suggestedDays} days, from ${jobCount} past ${jobCount === 1 ? 'job' : 'jobs'}, ${confidence} confidence`}
      testID="pace-chip"
    >
      <History size={11} color={t.accent} strokeWidth={2} />
      <Text style={styles.text}>
        Your pace: {suggestedDays}d ({jobCount} job{jobCount === 1 ? '' : 's'} · {confidence})
      </Text>
      <View style={[styles.dot, { backgroundColor: confidence === 'high' ? t.success : t.accent }]} />
    </TouchableOpacity>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  chip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5,
    alignSelf: 'flex-start' as const,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full,
    backgroundColor: t.accentSoft, marginTop: 3,
  },
  text: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.accent, letterSpacing: 0.2 },
  dot: { width: 5, height: 5, borderRadius: Tokens.radius.full },
});
