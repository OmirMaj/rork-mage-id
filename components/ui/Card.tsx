// Card — compositional surface for any content block.
//
// Usage:
//   <Card>
//     <Card.Label>Project · In Progress</Card.Label>
//     <Card.Title>The Henderson Residence</Card.Title>
//     <Card.Meta>3,200 sf · Brownstone</Card.Meta>
//     ...
//   </Card>
//
// Optionally pressable (wires Pressable + haptic + scale).
//
// WHY radius / pad / bordered EXIST (2026-09-07 app-experience audit, "worth
// doing" 29). This primitive had ONE importer against ~700 hand-rolled
// `backgroundColor: t.surface` + `borderRadius` recipes in app/ and
// components/. The audit read that as adoption failure; the mechanical reason
// is narrower and fixable: Card could only draw ONE of the shapes the app
// actually uses. Its single recipe (radius.lg 14 / padding 16 / 1pt hairline)
// matches 33 of those ~700. The other clusters — radius.card with no padding
// (75), radius.lg with padding 14 (50), radius.panel with padding 16 (44) —
// differ from it in radius, in padding, or in having no border at all, so
// converting one meant accepting a visible change to that screen. Nobody did.
//
// So the three axes that actually vary are props, with today's values as the
// defaults. A hand-rolled recipe can now convert with no pixels moving, which
// is the precondition for the ratchet in scripts/validate-ui-adoption.ts to
// ever come down.

import React, { useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Animated,
  StyleSheet,
  Platform,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { EyebrowLabel } from './EyebrowLabel';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

interface CardProps {
  children: React.ReactNode;
  pressable?: boolean;
  onPress?: () => void;
  /** Corner radius token. Defaults to `lg` (14). */
  radius?: keyof typeof Tokens.radius;
  /** Inner padding in points, or 'none' for a card that pads its own rows. */
  pad?: number | 'none';
  /** The 1pt hairline. Off for the flat-on-bg card idiom. */
  bordered?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Screen-reader label when pressable. Falls back to "Card" if omitted. */
  accessibilityLabel?: string;
}

interface SlotProps {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}

function CardRoot({
  children, pressable, onPress, radius = 'lg', pad, bordered = true, style, testID, accessibilityLabel,
}: CardProps) {
  const styles = useThemedStyles(makeStyles);
  const scale = useRef(new Animated.Value(1)).current;

  const shape: ViewStyle = {
    borderRadius: Tokens.radius[radius],
    padding: pad === 'none' ? 0 : pad ?? Tokens.spacing.md,
    borderWidth: bordered ? 1 : 0,
  };
  const cardStyle = [styles.card, shape, style];

  if (!pressable || !onPress) {
    return (
      <View style={cardStyle} testID={testID}>
        {children}
      </View>
    );
  }

  const handlePressIn = () => {
    Animated.spring(scale, { toValue: 0.985, useNativeDriver: true, ...Tokens.motion.spring.snap }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, ...Tokens.motion.spring.snap }).start();
  };
  const handlePress = () => {
    if (Platform.OS === 'ios') Haptics.selectionAsync().catch(() => {});
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={cardStyle}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? 'Card'}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

function CardLabel({ children }: { children: string }) {
  return <EyebrowLabel tone="neutral" showDot={false}>{children}</EyebrowLabel>;
}

// Card rows are BODY UI, not display type, so they sit on the sans ladder —
// the same steps every other list row in the app uses (compare the Discover
// rows: a Type.body/700 title over a Type.footnote subtitle).
//
// These two slots used to be Type.serifHeadline (Fraunces 22) over
// Type.monoCaption (JetBrains Mono 12). Both are real Type tokens, so no
// validator flagged them — but stacking them on every row made the one screen
// that renders <Card>, the Estimate hub under Discover, read in a completely
// different typeface AND scale from the rest of the app: serif headlines over
// monospaced body copy where everything else is system sans. Fraunces and
// JetBrains Mono stay reserved for what they are for — screen-level display
// titles (Type.serif*) and micro/numeric labels (Type.mono*).
function CardTitle({ children, style }: SlotProps) {
  const { colors } = useTheme();
  return <Text style={[Type.headline, { color: colors.text, marginTop: 4 }, style]}>{children}</Text>;
}

function CardMeta({ children, style }: SlotProps) {
  const { colors } = useTheme();
  return <Text style={[Type.footnote, { color: colors.textMuted, marginTop: 6 }, style]}>{children}</Text>;
}

/**
 * The card recipe as a STYLE, for the ~700 places that are a StyleSheet entry
 * rather than a JSX wrapper.
 *
 * `<Card>` cannot absorb most of them and that is not an adoption failure, it
 * is the shape of the codebase: a real entry is the surface recipe PLUS layout
 * that belongs to its screen —
 *
 *   maintCard: { backgroundColor: t.surface, borderRadius: Tokens.radius.card,
 *                padding: 14, marginBottom: 8, gap: 4 }
 *
 * — and wrapping that in `<Card style={{ marginBottom: 8, gap: 4 }}>` moves the
 * layout into JSX without removing a line. Spreading this instead keeps the
 * layout where it belongs and puts the four properties that must agree
 * app-wide (surface, hairline colour, radius scale, iOS squircle) in one place:
 *
 *   maintCard: { ...cardSurface(t, { radius: 'card', pad: 14, bordered: false }),
 *                marginBottom: 8, gap: 4 }
 *
 * `<Card>` itself is built on this, so the two can never drift.
 */
export function cardSurface(
  t: ThemeColors,
  opts: { radius?: keyof typeof Tokens.radius; pad?: number | 'none'; bordered?: boolean } = {},
): ViewStyle {
  const { radius = 'lg', pad, bordered = true } = opts;
  return {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius[radius],
    padding: pad === 'none' ? 0 : pad ?? Tokens.spacing.md,
    borderWidth: bordered ? 1 : 0,
    borderColor: t.line,
    ...Tokens.continuousCorners,
  };
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    // radius / padding / borderWidth are overlaid per instance above; only the
    // colours and the squircle are fixed here.
    card: {
      backgroundColor: t.surface,
      borderColor: t.line,
      ...Tokens.continuousCorners,
    },
  });

export const Card = Object.assign(CardRoot, {
  Label: CardLabel,
  Title: CardTitle,
  Meta: CardMeta,
});

export default Card;
