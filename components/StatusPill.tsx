// StatusPill — the canonical "small colored pill that communicates state"
// component.
//
// Audit found this same atom rendered 4 different ways: Summary's
// `healthPill`, Project Detail's `STATUS_TONES`, Notifications inbox's
// inline tint logic, and Buyout's raw `STATUS_COLORS`. One implementation
// here lets us fix all of them at once and lock the visual language.
//
// Tone is the only color-bearing prop — the pill earns its color by
// communicating something (success, warning, etc.). For a neutral
// rendering, pass `tone="neutral"`.

import React, { memo } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export type StatusTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'accent';

export interface StatusPillProps {
  /** Label rendered inside the pill. Auto-uppercased. */
  label: string;
  /** Color tone — drives both background tint (15% alpha) and text color. */
  tone?: StatusTone;
  /** Optional small icon to the left of the label. */
  Icon?: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  /** Compact size if you're rendering inline in a tight row. */
  size?: 'default' | 'compact';
  style?: ViewStyle;
  testID?: string;
}

const TONE_COLORS: Record<StatusTone, string> = {
  neutral: Colors.textSecondary,
  primary: Colors.primary,
  success: Colors.success,
  warning: Colors.warning,
  error: Colors.error,
  info: Colors.info,
  accent: Colors.accent,
};

function StatusPillImpl({
  label,
  tone = 'neutral',
  Icon,
  size = 'default',
  style,
  testID,
}: StatusPillProps) {
  const color = TONE_COLORS[tone];
  const isCompact = size === 'compact';
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: color + '18',
          paddingHorizontal: isCompact ? 6 : 8,
          paddingVertical: isCompact ? 2 : 4,
        },
        style,
      ]}
      testID={testID}
    >
      {Icon && <Icon size={isCompact ? 10 : 12} color={color} strokeWidth={2.4} />}
      <Text
        style={[
          isCompact ? Type.caption2 : Type.caption1,
          {
            color,
            fontWeight: '700',
            letterSpacing: 0.4,
            textTransform: 'uppercase',
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

export const StatusPill = memo(StatusPillImpl);

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Tokens.radius.sm,
    alignSelf: 'flex-start',
  },
});
