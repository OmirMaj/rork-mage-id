// TrustRow — small reassurance footnote with an icon.
//
// The "Secure payment via App Store" line at the bottom of Paywall;
// the "End-to-end encrypted" footer on Settings → Account; the "Your
// data never leaves your account" footnote on the lead-capture marketing
// form. Same shape every time: a small icon (Shield, Lock, ShieldCheck,
// Check, etc.) followed by a single line of secondary text.
//
// 10+ inline reimplementations in components/Paywall.tsx,
// components/PDFPreSendSheet.tsx, app/profile.tsx, etc. — each with
// drift in icon size, color, gap, text weight. TrustRow is the
// canonical version.
//
// This is intentionally a *small* component — one icon, one line of
// text. For multi-signal rows (license + COI + response time), use the
// domain-specific TrustBadgeRow in components/, not this primitive.

import React, { memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { Shield, type LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export type TrustRowTone = 'neutral' | 'success' | 'info' | 'accent';

export interface TrustRowProps {
  /** The reassurance text. Keep short — 1 line, 6-12 words. */
  label: string;
  /** Icon. Defaults to Shield. Use Lock for security, Check for verified,
   *  ShieldCheck for compliance, Sparkles for AI privacy, etc. */
  icon?: LucideIcon;
  /** Tone — controls the icon color. Text stays subtle regardless. */
  tone?: TrustRowTone;
  /**
   * Visual style:
   *   - "subtle" (default): no background, centered, footnote-sized.
   *     For paywall / form footers.
   *   - "inline": no background, left-aligned, sits inline with content.
   *     For the line under a section header.
   */
  variant?: 'subtle' | 'inline';
  /** Optional style override. */
  style?: StyleProp<ViewStyle>;
  /** testID for E2E. */
  testID?: string;
}

const TONE_COLOR: Record<TrustRowTone, string> = {
  neutral: Colors.textSecondary,
  success: Colors.success,
  info:    Colors.info,
  accent:  Colors.accent,
};

function TrustRowImpl({
  label,
  icon: Icon = Shield,
  tone = 'neutral',
  variant = 'subtle',
  style,
  testID,
}: TrustRowProps) {
  const iconColor = TONE_COLOR[tone];

  return (
    <View
      style={[
        styles.base,
        variant === 'subtle' ? styles.subtle : styles.inline,
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={label}
      testID={testID}
    >
      <Icon size={13} color={iconColor} strokeWidth={2} />
      <Text
        style={[Type.caption1, { color: Colors.textSecondary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

export const TrustRow = memo(TrustRowImpl);

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Tokens.spacing.xxs,
  },
  subtle: {
    justifyContent: 'center',
  },
  inline: {
    justifyContent: 'flex-start',
  },
});
