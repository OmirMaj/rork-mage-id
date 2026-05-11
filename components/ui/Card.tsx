// Card — the foundational surface primitive.
//
// Why this exists: an audit (2026-05) found 105 components across the
// app, none of them composed from a shared primitive layer. Every card,
// tile, and panel reimplements its own background + radius + padding +
// shadow recipe. Result: ~150 hardcoded hex colors, 1,492 hardcoded
// spacing values in components/, and zero usages of the Tokens.spacing
// / Tokens.shadow tokens that already exist in designTokens.ts.
//
// Card is the floor of the new primitive layer at components/ui/. It
// consumes Colors + Tokens directly, so any screen built on Card
// inherits the design system automatically. New surfaces should reach
// for <Card> before they reach for <View style={{ background, radius,
// padding }} />.
//
// Variants:
//   - default:  surface bg + subtle resting shadow. The 90% case.
//   - elevated: medium shadow. For surfaces that need to read as floating
//               (active drag, hover, modal-like callouts inside a screen).
//   - flat:     border only, no shadow. For grouped lists where the
//               surrounding section provides the elevation cue.
//   - tinted:   accent-tinted bg, no shadow. For status callouts (success
//               banner, warning notice). Pass `tone` to color it.
//
// When you tap a Card (onPress provided), it uses Pressable + a subtle
// opacity dip + iOS continuous-corner mask for the proper Apple feel.

import React, { memo } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
  type GestureResponderEvent,
} from 'react-native';
import { Colors } from '@/constants/colors';
import { Tokens, continuousCorners } from '@/constants/designTokens';

export type CardVariant = 'default' | 'elevated' | 'flat' | 'tinted';

export type CardTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'accent';

// Tinted maps as functions, not constants — so neutral can read
// theme-aware Colors.fillSecondary / Colors.borderLight at render time.
// Status tints (success/warning/error/info) use Material-light fixed
// values that read OK on both surfaces.
function tintedBg(tone: CardTone): string {
  switch (tone) {
    case 'neutral': return Colors.fillSecondary;
    case 'primary': return 'rgba(26, 107, 60, 0.08)';
    case 'success': return Colors.successLight;
    case 'warning': return Colors.warningLight;
    case 'error':   return Colors.errorLight;
    case 'info':    return Colors.infoLight;
    case 'accent':  return Colors.accentSoft;
  }
}

function tintedBorder(tone: CardTone): string {
  switch (tone) {
    case 'neutral': return Colors.borderLight;
    case 'primary': return 'rgba(26, 107, 60, 0.20)';
    case 'success': return 'rgba(52, 199, 89, 0.24)';
    case 'warning': return 'rgba(255, 149, 0, 0.24)';
    case 'error':   return 'rgba(255, 59, 48, 0.24)';
    case 'info':    return 'rgba(0, 122, 255, 0.24)';
    case 'accent':  return 'rgba(255, 106, 26, 0.24)';
  }
}

export interface CardProps {
  /** Visual variant. Defaults to "default". */
  variant?: CardVariant;
  /** Tone — only used when variant is "tinted". Defaults to "neutral". */
  tone?: CardTone;
  /**
   * Padding around the children. Pass a Spacing key (e.g. "md", "lg") or
   * a raw number. Defaults to "md" (16pt). Pass "none" to opt out — useful
   * when the children handle their own padding (e.g. a NavRow inside).
   */
  padding?: keyof typeof Tokens.spacing | number | 'none';
  /**
   * Border radius. Pass a Radius key or raw number. Defaults to "card"
   * (12pt), matching the audit-identified most-common value.
   */
  radius?: keyof typeof Tokens.radius | number;
  /** Tap handler. Makes the Card a Pressable. */
  onPress?: (e: GestureResponderEvent) => void;
  /** Long-press handler. */
  onLongPress?: () => void;
  /** Disable the Card entirely (visual + non-interactive). */
  disabled?: boolean;
  /** Optional style override. Use sparingly — prefer variant + padding props. */
  style?: StyleProp<ViewStyle>;
  /** Accessibility label for screen readers (required when onPress is set). */
  accessibilityLabel?: string;
  /** testID for E2E. */
  testID?: string;
  children: React.ReactNode;
}

function resolvePadding(p: CardProps['padding']): number {
  if (p === undefined) return Tokens.spacing.md;
  if (p === 'none') return 0;
  if (typeof p === 'number') return p;
  return Tokens.spacing[p];
}

function resolveRadius(r: CardProps['radius']): number {
  if (r === undefined) return Tokens.radius.card;
  if (typeof r === 'number') return r;
  return Tokens.radius[r];
}

function CardImpl({
  variant = 'default',
  tone = 'neutral',
  padding,
  radius,
  onPress,
  onLongPress,
  disabled = false,
  style,
  accessibilityLabel,
  testID,
  children,
}: CardProps) {
  const pad = resolvePadding(padding);
  const rad = resolveRadius(radius);

  const baseStyle: ViewStyle = {
    padding: pad,
    borderRadius: rad,
    ...continuousCorners,
  };

  let variantStyle: ViewStyle;
  switch (variant) {
    case 'elevated':
      variantStyle = {
        backgroundColor: Colors.surfaceElevated,
        ...Tokens.shadow.medium,
      };
      break;
    case 'flat':
      variantStyle = {
        backgroundColor: Colors.surface,
        borderWidth: 1,
        borderColor: Colors.cardBorder,
      };
      break;
    case 'tinted':
      variantStyle = {
        backgroundColor: tintedBg(tone),
        borderWidth: 1,
        borderColor: tintedBorder(tone),
      };
      break;
    case 'default':
    default:
      variantStyle = {
        backgroundColor: Colors.surface,
        ...Tokens.shadow.subtle,
      };
      break;
  }

  const composedStyle = [
    styles.base,
    baseStyle,
    variantStyle,
    disabled && styles.disabled,
    style,
  ];

  // Non-interactive — render a View.
  if (!onPress && !onLongPress) {
    return (
      <View style={composedStyle} testID={testID}>
        {children}
      </View>
    );
  }

  // Interactive — render a Pressable.
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      style={({ pressed }) => [
        composedStyle,
        pressed && !disabled && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

export const Card = memo(CardImpl);

const styles = StyleSheet.create({
  base: {
    // Sensible defaults — anything inside a Card stacks vertically and
    // doesn't collapse. Override with explicit flexDirection on a child.
    overflow: 'hidden',
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.85,
  },
});
