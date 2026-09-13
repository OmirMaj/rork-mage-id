// StatusPill — the canonical "small colored pill that communicates state".
//
// Audit found this same atom rendered 4 different ways: Summary's
// `healthPill`, Project Detail's `STATUS_TONES`, Notifications inbox's
// inline tint logic, and Buyout's raw `STATUS_COLORS`. One implementation
// here lets us fix all of them at once and lock the visual language.
//
// Tone is the only color-bearing prop — the pill earns its color by
// communicating something (success, warning, etc.). For a neutral
// rendering, pass `tone="neutral"`.
//
// MOVED from components/StatusPill.tsx on 2026-09-07 (app-experience audit,
// "worth doing" 29). It had ZERO importers, and the audit's guess for why —
// its name collided with components/schedule/StatusPill.tsx, a different
// component with a different job — is probably right, so it now lives in the
// primitive barrel and is imported from `@/components/ui`.
//
// WHAT IT WOULD HAVE SHIPPED TO ITS FIRST ADOPTER. Reading it to move it, the
// default rendering was broken and three tones were wrong:
//
//   • `tone="neutral"` (the DEFAULT) resolved to `t.textSecondary`, which is an
//     rgba() string in the light theme, and then painted the fill as
//     `color + '18'`. RN's normalizeColor keeps the rgba() prefix and DROPS the
//     hex suffix — the documented bug in constants/colors.ts — so the intended
//     9% wash rendered as the FULL 78%-opacity ink, with 78%-opacity ink text
//     on top of it. A featureless grey slab at ~1.0:1. validate-contrast check 3
//     pins that shape, but only where the token name and the suffix are on the
//     same line; here `toneColor()` launders it through a variable.
//   • `tone="warning"` returned `t.accent`. Not a near-miss — amber-orange IS
//     the brand accent, so the bug reads as correct until you notice `primary`
//     returns the identical value and warning has no colour of its own.
//   • `primary` / `accent` / `success` / `error` returned the SIGNAL hues,
//     which are for dots and bars. As TEXT on a wash of themselves they are
//     what validate-contrast check 5 exists to stop: `t.accent` (#FF6A1A) is
//     2.87:1, and founder decision #1 routes text through `accentLabel`.
//
// Fill and ink are now separate: the ink is the theme's *Label token (AA-
// verified by check 5 on exactly this idiom) and the fill is the matching
// *Soft token, which is a real rgba and never alpha-suffixed.

import React, { memo } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';
import { neutralInk } from './ink';

export type StatusTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'accent';

export interface StatusPillProps {
  /** Label rendered inside the pill. Auto-uppercased. */
  label: string;
  /** Color tone — drives both background tint and text color. */
  tone?: StatusTone;
  /** Optional small icon to the left of the label. */
  Icon?: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  /** Compact size if you're rendering inline in a tight row. */
  size?: 'default' | 'compact';
  style?: ViewStyle;
  testID?: string;
}

/**
 * Ink + fill per tone. Measured on `surface`, light / dark:
 *   success 5.53 / 8.02   warning 4.80 / 7.16   error 4.80 / 5.30
 *   info    5.03 / 6.10   neutral 5.39 / 5.72   accent — see check 12
 *
 * `info` has no `infoSoft` token, and `info` is a solid hex in both themes, so
 * suffixing it is the legitimate `+ 'NN'` path (unlike the rgba text tokens).
 */
function tonePalette(t: ThemeColors, tone: StatusTone): { ink: string; fill: string } {
  switch (tone) {
    case 'primary':
    case 'accent':
      return { ink: t.accentLabel, fill: t.accentSoft };
    case 'success':
      return { ink: t.successLabel, fill: t.successSoft };
    case 'warning':
      return { ink: t.warningLabel, fill: t.warningSoft };
    case 'error':
      return { ink: t.dangerLabel, fill: t.dangerSoft };
    case 'info':
      return { ink: t.info, fill: t.info + '18' };
    case 'neutral':
    default:
      return { ink: neutralInk(t), fill: t.neutralSoft };
  }
}

function StatusPillImpl({
  label,
  tone = 'neutral',
  Icon,
  size = 'default',
  style,
  testID,
}: StatusPillProps) {
  const { colors } = useTheme();
  const { ink, fill } = tonePalette(colors, tone);
  const isCompact = size === 'compact';
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: fill,
          paddingHorizontal: isCompact ? 6 : 8,
          paddingVertical: isCompact ? 2 : 4,
        },
        style,
      ]}
      testID={testID}
    >
      {Icon && <Icon size={isCompact ? 10 : 12} color={ink} strokeWidth={2.4} />}
      <Text
        style={[
          isCompact ? Type.caption2 : Type.caption1,
          {
            color: ink,
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

export default StatusPill;

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Tokens.radius.sm,
    alignSelf: 'flex-start',
  },
});
