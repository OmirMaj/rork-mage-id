// Pill — small status chip.
//
// Pills appear ~30 times across the app: status badges on cards, count
// indicators on tabs, tags on filter chips, severity labels on alerts.
// Audit (2026-05) found every one re-implemented inline with its own
// padding + radius + color stack. Pill is the canonical replacement.
//
// Anatomy: optional Lucide icon + label, both horizontally centered,
// pill-shaped (Radius.full), with a tinted background and matching
// foreground color. The tone palette is intentionally the same as
// NavRow's so cards and pills agree on what color "AI" / "permits" /
// "warning" mean.
//
// Two sizes:
//   - sm:  caption2 text + xxs padding. For dense rows (3+ pills in a row).
//   - md:  footnote text + xs padding. For standalone status badges.

import React, { memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
} from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens, continuousCorners } from '@/constants/designTokens';

export type PillTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'accent'
  | 'violet'
  | 'teal'
  | 'rose'
  | 'amber'
  | 'indigo'
  | 'emerald'
  | 'sky';

export type PillSize = 'sm' | 'md';

export interface PillProps {
  /** Pill label. Keep short — 1-3 words. */
  label: string;
  /** Tone — controls both bg tint and fg color. Defaults to "neutral". */
  tone?: PillTone;
  /** Size variant. Defaults to "md". */
  size?: PillSize;
  /** Optional leading icon (Lucide). */
  icon?: LucideIcon;
  /**
   * Visual style:
   *  - "tinted":  pale tinted bg + dark fg. The default. Subtle.
   *  - "solid":   solid bg + white fg. For loud emphasis.
   *  - "outline": transparent bg + tinted border + tinted fg.
   */
  variant?: 'tinted' | 'solid' | 'outline';
  /** Optional style override. */
  style?: StyleProp<ViewStyle>;
  /** testID for E2E. */
  testID?: string;
}

// Foreground (text + icon) color for each tone.
const TONE_FG: Record<PillTone, string> = {
  neutral: Colors.textSecondary,
  primary: Colors.primary,
  success: Colors.successDark,
  warning: Colors.warningDark,
  error:   Colors.errorDark,
  info:    Colors.infoDark,
  accent:  Colors.accent,
  violet:  '#7C3AED',
  teal:    '#0D9488',
  rose:    '#E11D48',
  amber:   '#D97706',
  indigo:  '#4F46E5',
  emerald: '#059669',
  sky:     '#0284C7',
};

// Background tint for variant="tinted". Pale tinted version of the FG.
const TONE_TINT: Record<PillTone, string> = {
  neutral: Colors.fillSecondary,
  primary: 'rgba(26, 107, 60, 0.12)',
  success: Colors.successLight,
  warning: Colors.warningLight,
  error:   Colors.errorLight,
  info:    Colors.infoLight,
  accent:  Colors.accentSoft,
  violet:  'rgba(124, 58, 237, 0.12)',
  teal:    'rgba(13, 148, 136, 0.12)',
  rose:    'rgba(225, 29, 72, 0.12)',
  amber:   'rgba(217, 119, 6, 0.12)',
  indigo:  'rgba(79, 70, 229, 0.12)',
  emerald: 'rgba(5, 150, 105, 0.12)',
  sky:     'rgba(2, 132, 199, 0.12)',
};

function PillImpl({
  label,
  tone = 'neutral',
  size = 'md',
  icon: Icon,
  variant = 'tinted',
  style,
  testID,
}: PillProps) {
  const fg = TONE_FG[tone];
  const tint = TONE_TINT[tone];

  const sizing = SIZE_STYLES[size];

  let variantStyle: ViewStyle;
  switch (variant) {
    case 'solid':
      variantStyle = { backgroundColor: fg };
      break;
    case 'outline':
      variantStyle = {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: fg,
      };
      break;
    case 'tinted':
    default:
      variantStyle = { backgroundColor: tint };
      break;
  }

  const fgColor = variant === 'solid' ? Colors.surface : fg;

  return (
    <View
      style={[styles.base, sizing.box, variantStyle, style]}
      accessibilityRole="text"
      accessibilityLabel={label}
      testID={testID}
    >
      {Icon ? (
        <Icon
          size={sizing.iconSize}
          color={fgColor}
          strokeWidth={2.2}
        />
      ) : null}
      <Text
        style={[
          sizing.text,
          { color: fgColor, fontWeight: '600' },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

export const Pill = memo(PillImpl);

type SizeStyle = { box: ViewStyle; text: TextStyle; iconSize: number };

const SIZE_STYLES: Record<PillSize, SizeStyle> = {
  sm: {
    box: {
      paddingHorizontal: Tokens.spacing.xs,
      paddingVertical: Tokens.spacing.hairline,
      gap: Tokens.spacing.xxs,
      minHeight: 18,
    },
    text: Type.caption2,
    iconSize: 10,
  },
  md: {
    box: {
      paddingHorizontal: Tokens.spacing.sm,
      paddingVertical: Tokens.spacing.xxs,
      gap: Tokens.spacing.xxs,
      minHeight: 22,
    },
    text: Type.footnote,
    iconSize: 12,
  },
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start', // pills hug their content, don't stretch
    borderRadius: Tokens.radius.full,
    ...continuousCorners,
  },
});
