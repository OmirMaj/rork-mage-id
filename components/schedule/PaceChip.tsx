// components/schedule/PaceChip.tsx — "Your pace: 9d (4 jobs)" suggestion chip.
//
// Rendered on schedule-review task cards when the pace book knows this trade
// at medium+ confidence AND disagrees with the AI's proposed duration by at
// least a day. Tapping applies the suggestion; it is never automatic, and
// low-confidence/no-history renders nothing (silence, not noise). The small
// dot signals confidence: accent = medium, success-green = high.
//
// preApplied variant (F4, earned autonomy): when the per-trade gate is passed
// the duration is PRE-SET from the GC's pace at draft arrival; the chip then
// reads "Set from your N jobs · tap for AI's Xd" and tapping REVERTS to the
// AI's original duration (the caller wires onApply to the revert). Green
// success tint distinguishes "already done for you" from "offer".
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
  /** Suggest mode: applies the suggestion. Pre-applied mode: reverts to the
   *  AI's original duration. */
  onApply: () => void;
  /** F4: renders the pre-applied badge instead of the suggest chip. */
  preApplied?: boolean;
  /** The AI draft's original duration — the revert target named on the badge.
   *  Required in spirit when preApplied is set. */
  aiOriginalDays?: number;
}

export default function PaceChip({ suggestedDays, jobCount, confidence, onApply, preApplied, aiOriginalDays }: PaceChipProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);

  if (preApplied) {
    return (
      <TouchableOpacity
        style={[styles.chip, styles.chipPreApplied]}
        onPress={onApply}
        activeOpacity={0.8}
        hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={`Duration set from your pace across ${jobCount} ${jobCount === 1 ? 'job' : 'jobs'}. Tap to use the AI's original ${aiOriginalDays ?? suggestedDays} days.`}
        testID="pace-chip-preapplied"
      >
        <History size={11} color={t.success} strokeWidth={2} />
        <Text style={[styles.text, { color: t.success }]}>
          Set from your {jobCount} job{jobCount === 1 ? '' : 's'} · tap for AI&apos;s {aiOriginalDays ?? suggestedDays}d
        </Text>
        <View style={[styles.dot, { backgroundColor: t.success }]} />
      </TouchableOpacity>
    );
  }

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
  chipPreApplied: { backgroundColor: t.successSoft },
  text: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.accent, letterSpacing: 0.2 },
  dot: { width: 5, height: 5, borderRadius: Tokens.radius.full },
});
