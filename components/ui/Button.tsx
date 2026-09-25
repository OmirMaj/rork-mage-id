// Button — primary primitive for actions. Phase 1 design system.
//
// Variants:  primary | secondary | ghost | destructive
// Sizes:     sm | md | lg
//
// Bakes in: theme-aware colors, continuous corners, haptic on press
// (iOS only), spring scale on press, disabled state, loading state.
//
// Consumers must NOT pass `style` overrides for color/background; that's
// the point of the primitive. Use a different variant if the existing
// ones don't fit.
//
// LAYOUT: `style` lands on the inner Pressable (the painted pill), so a
// layout key there — `flex: 1`, `alignSelf` — acts INSIDE the animated
// wrapper, not in the caller's row. That is why `style={{ flex: 1 }}` never
// split change-order's or contract's rows on their own. Every remaining
// `style={{ flex: 1 }}` call site now sits inside an <ActionBar>, which
// neutralises it on desktop (flexGrow/Shrink/Basis longhands, a 40 px row
// right-aligned to the form) and leaves the phone exactly as it was; the
// validate-desktop-layout stretchedButtons count fails one outside a bar. A
// NEW layout key goes on `containerStyle` (the wrapper) behind a desktop gate,
// or the row goes through ActionBar.
//
// DESKTOP WEB (wave 6b). The wrapper had no width, so on web it stretched
// with its column and `fullWidth={false}` still drew a 1,360 px button. Behind
// useIsDesktopWeb() only:
//   - the wrapper hugs its label (`width: fit-content`, a CSS value RN-web
//     passes through untouched) without changing cross-axis alignment in rows;
//   - fullWidth caps at Layout.button.fullWidthMax (400);
//   - heights 32 / 40 / 48 and min widths 72 / 96 / 120 (Layout.control /
//     Layout.button) replace the 36 / 48 / 56 touch sizes;
//   - inside an <ActionBar>, fullWidth is ignored and the bar sizes the button.
// On a phone and on native the wrapper stays exactly `{ transform: [{ scale }] }`
// and SIZE_MAP is untouched — the phone render is byte-identical (proved by
// __tests__/smoke/ui-desktop-primitives.test.tsx against a copy of the old one).

import React, { useRef } from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  Animated,
  ActivityIndicator,
  View,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Layout, Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useInActionBar } from './ActionBar';
import { useIsDesktopWeb } from './desktop';
import { nativeDriver, reducedMotion } from './motion';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Applied to the outer (animated) wrapper — the element that actually sits
   *  in the caller's row/column. Use it for layout keys: flex, alignSelf,
   *  margin, width. */
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

const SIZE_MAP: Record<ButtonSize, { height: number; px: number; fontSize: number }> = {
  sm: { height: 36, px: 16, fontSize: 13 },
  md: { height: Tokens.touchTarget.comfortable, px: 24, fontSize: 14 },
  lg: { height: 56, px: 28, fontSize: 15 },
};

/** Desktop-web control sizes (Layout.control / Layout.button). A mouse does not
 *  need a 48 pt touch target; a 48 pt button on a monitor reads as a banner. */
const DESKTOP_SIZE_MAP: Record<ButtonSize, { height: number; px: number; minWidth: number }> = {
  sm: { height: Layout.control.sm, px: 14, minWidth: Layout.button.minWidth.sm },
  md: { height: Layout.control.md, px: 20, minWidth: Layout.button.minWidth.md },
  lg: { height: Layout.control.lg, px: 24, minWidth: Layout.button.minWidth.lg },
};

/** Hug the label. 'fit-content' is CSS-only, hence web-only and the cast. */
const DESKTOP_HUG = { width: 'fit-content', maxWidth: '100%' } as unknown as ViewStyle;

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  iconLeft,
  iconRight,
  fullWidth = false,
  style,
  containerStyle,
  testID,
}: ButtonProps) {
  const desktop = useIsDesktopWeb();
  const inBar = useInActionBar();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const scale = useRef(new Animated.Value(1)).current;

  const sz = SIZE_MAP[size];
  const isDisabled = disabled || loading;

  // Motion.spring.snap is ζ≈0.83: the press settles with no wobble on
  // release. Reduce Motion: no press scale at all (the value stays at 1).
  const handlePressIn = () => {
    if (reducedMotion()) return;
    Animated.spring(scale, {
      toValue: 0.97,
      useNativeDriver: nativeDriver,
      ...Tokens.motion.spring.snap,
    }).start();
  };
  const handlePressOut = () => {
    if (reducedMotion()) { scale.setValue(1); return; }
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: nativeDriver,
      ...Tokens.motion.spring.snap,
    }).start();
  };
  const handlePress = () => {
    if (Platform.OS === 'ios') {
      Haptics.selectionAsync().catch(() => {});
    }
    onPress();
  };

  // Phone / native: today's exact array. Desktop web: the desktop box, and
  // fullWidth only outside an ActionBar (the bar owns the size there).
  const dsz = DESKTOP_SIZE_MAP[inBar ? 'md' : size];
  const stretch = fullWidth && !(desktop && inBar);
  //
  // Desktop web only, the style is a function of RN-web's hover state: a
  // filled button darkens a touch, a quiet one takes a soft fill, and the
  // global CSS in components/desktop/webDocument.ts (MOTION_CSS) glides the
  // colour over 120 ms. At rest it returns the plain desktop array itself —
  // no trailing entry — so an un-hovered tree is unchanged.
  const desktopArray: StyleProp<ViewStyle> = [
    styles.base,
    styles[variant],
    { height: dsz.height, paddingHorizontal: dsz.px, minWidth: dsz.minWidth },
    stretch && styles.fullWidth,
    isDisabled && styles.disabled,
    style,
  ];
  const hoverStyle =
    variant === 'primary' || variant === 'destructive'
      ? styles.hoverFill
      : variant === 'ghost'
        ? styles.hoverGhost
        : styles.hoverQuiet;
  const pressableStyle: React.ComponentProps<typeof Pressable>['style'] = desktop
    ? (state) =>
        (state as { hovered?: boolean }).hovered && !isDisabled ? [desktopArray, hoverStyle] : desktopArray
    : [
        styles.base,
        styles[variant],
        { height: sz.height, paddingHorizontal: sz.px },
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ];

  // The wrapper is what sits in the caller's layout. On a phone it stays the
  // bare transform object it has always been (unless the caller opts into
  // containerStyle). On desktop web a fullWidth button fills its column up to
  // 400 — flexShrink lets two of them share a row that is narrower than 800
  // instead of overflowing it, and minHeight stops that shrink from ever
  // eating the button's height in a height-capped column.
  const scaleStyle = { transform: [{ scale }] };
  const wrapperStyle: StyleProp<ViewStyle> = desktop
    ? [
        scaleStyle,
        stretch
          ? { width: '100%', maxWidth: Layout.button.fullWidthMax, flexShrink: 1, minHeight: dsz.height }
          : DESKTOP_HUG,
        containerStyle,
      ]
    : containerStyle
      ? [scaleStyle, containerStyle]
      : scaleStyle;

  const textColor =
    variant === 'primary' || variant === 'destructive'
      ? '#FFFFFF'
      : colors.text;

  return (
    <Animated.View style={wrapperStyle}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isDisabled}
        style={pressableStyle}
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled }}
      >
        {loading && !desktop ? (
          <ActivityIndicator color={textColor} />
        ) : (
          // Desktop web: loading keeps the label row (invisible) so the button
          // holds its width, and the spinner sits over it — a hugging button
          // no longer shrinks to a spinner and back. The phone keeps today's
          // swap (ui-desktop-primitives proves it against the old Button).
          <>
            <View style={loading ? [styles.row, styles.labelHidden] : styles.row}>
              {iconLeft ? <View style={styles.iconLeft}>{iconLeft}</View> : null}
              <Text style={[styles.label, { fontSize: sz.fontSize, color: textColor }]}>
                {label}
              </Text>
              {iconRight ? <View style={styles.iconRight}>{iconRight}</View> : null}
            </View>
            {loading ? (
              <View pointerEvents="none" style={styles.spinnerOverlay}>
                <ActivityIndicator color={textColor} />
              </View>
            ) : null}
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    base: {
      borderRadius: Tokens.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      ...Tokens.continuousCorners,
    },
    primary: {
      // White label sits on this fill (textColor === '#FFFFFF' above), so the
      // fill must clear 4.5:1 for white — brand accent #FF6A1A is only 2.87:1.
      // accentFill (#BC440C, white 5.29:1) is the accessible button fill; the
      // brand hue still reads (HSL 19°). Shadow stays the brighter accent — a
      // shadow carries no text, so the 4.5:1 rule does not apply to it.
      backgroundColor: t.accentFill,
      shadowColor: t.accent,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.25,
      shadowRadius: 16,
      elevation: 4,
    },
    secondary: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
    },
    ghost: {
      backgroundColor: 'transparent',
    },
    destructive: {
      backgroundColor: t.danger,
    },
    fullWidth: { width: '100%' },
    disabled: { opacity: 0.5 },
    label: {
      fontWeight: '600' as const,
      letterSpacing: -0.15,
    },
    row: { flexDirection: 'row', alignItems: 'center' },
    labelHidden: { opacity: 0 },
    spinnerOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Desktop-web hover (see pressableStyle).
    hoverFill: { filter: 'brightness(0.94)' },
    hoverQuiet: { backgroundColor: t.surfaceAlt },
    hoverGhost: { backgroundColor: t.neutralSoft },
    iconLeft: { marginRight: 8 },
    iconRight: { marginLeft: 8 },
  });

export default Button;
