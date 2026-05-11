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

// Tone-color resolvers as functions — Colors.* reads happen at render
// time, so the `neutral` / `primary` / status tones swap correctly on
// theme change. Extended hues (violet/teal/rose/amber/indigo/emerald/
// sky) are brand-anchored fixed values that work across both themes.
function toneFg(tone: PillTone): string {
  switch (tone) {
    case 'neutral': return Colors.textSecondary;
    case 'primary': return Colors.primary;
    case 'success': return Colors.successDark;
    case 'warning': return Colors.warningDark;
    case 'error':   return Colors.errorDark;
    case 'info':    return Colors.infoDark;
    case 'accent':  return Colors.accent;
    case 'violet':  return '#7C3AED';
    case 'teal':    return '#0D9488';
    case 'rose':    return '#E11D48';
    case 'amber':   return '#D97706';
    case 'indigo':  return '#4F46E5';
    case 'emerald': return '#059669';
    case 'sky':     return '#0284C7';
  }
}

function toneTint(tone: PillTone): string {
  switch (tone) {
    case 'neutral': return Colors.fillSecondary;
    case 'primary': return 'rgba(26, 107, 60, 0.12)';
    case 'success': return Colors.successLight;
    case 'warning': return Colors.warningLight;
    case 'error':   return Colors.errorLight;
    case 'info':    return Colors.infoLight;
    case 'accent':  return Colors.accentSoft;
    case 'violet':  return 'rgba(124, 58, 237, 0.12)';
    case 'teal':    return 'rgba(13, 148, 136, 0.12)';
    case 'rose':    return 'rgba(225, 29, 72, 0.12)';
    case 'amber':   return 'rgba(217, 119, 6, 0.12)';
    case 'indigo':  return 'rgba(79, 70, 229, 0.12)';
    case 'emerald': return 'rgba(5, 150, 105, 0.12)';
    case 'sky':     return 'rgba(2, 132, 199, 0.12)';
  }
}

function PillImpl({
  label,
  tone = 'neutral',
  size = 'md',
  icon: Icon,
  variant = 'tinted',
  style,
  testID,
}: PillProps) {
  const fg = toneFg(tone);
  const tint = toneTint(tone);

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
