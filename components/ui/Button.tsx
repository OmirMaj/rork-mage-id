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
//
// LOADING (round 2, 'slicker'). Both platforms now keep the label row laid out
// (invisible) under the spinner, so a loading button holds its width on a
// phone too — the old phone swap to a bare spinner shrank a hugging button.
//
// THE COMMIT MORPH (round 2). `done` shows a check where the label was. When
// `loading` / `done` CHANGE after mount the button arms ONE morph: label →
// spinner → check on a teal fill (primary), at full opacity, same width and
// height, then back. It is armed only by a phase change measured against the
// last committed phase, so a button that never changes — or one that mounts
// loading — renders the static tree below (desktop byte-identical to before).
// Reduce Motion: every value jumps to its target; the check, the success
// haptic and the VoiceOver announcement still happen. Drive it with
// useCommitFeedback() at the bottom of this file.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  Animated,
  ActivityIndicator,
  AccessibilityInfo,
  Easing,
  View,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Check } from 'lucide-react-native';
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
  /** Commit feedback: while true the button shows a check where its label was, keeps its width and height, and disables the press. Drive it with useCommitFeedback(). */
  done?: boolean;
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

// hoist into Motion.duration after round 2
/** How long the check holds before the button returns to its label. */
const COMMIT_HOLD_MS = 900;
// hoist into Motion.duration after round 2
/** Label ↔ spinner ↔ check cross-fade. */
const MORPH_MS = 140;
// hoist into Motion.duration after round 2
/** The teal fill arriving, and the whole morph settling back to the label. */
const SETTLE_MS = 200;

type CommitPhase = 'idle' | 'loading' | 'done';
type MorphValues = {
  labelO: Animated.Value;
  spinO: Animated.Value;
  checkO: Animated.Value;
  checkS: Animated.Value;
  tintO: Animated.Value;
};
/** Where each layer rests in each phase (checkS is handled on its own). */
const PHASE_TARGETS: Record<CommitPhase, { labelO: number; spinO: number; checkO: number; tintO: number }> = {
  idle: { labelO: 1, spinO: 0, checkO: 0, tintO: 0 },
  loading: { labelO: 0, spinO: 1, checkO: 0, tintO: 0 },
  done: { labelO: 0, spinO: 0, checkO: 1, tintO: 1 },
};
const CHECK_SCALE_FROM = 0.6;

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  done = false,
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
  const isDisabled = disabled || loading || done;

  // ── The commit morph: armed ONLY by a phase CHANGE after mount. ──
  // committedPhase is the last phase the layout effect below committed; the
  // render that first sees a different phase arms the morph and seeds the
  // five values from the phase being LEFT, so the first armed frame looks
  // exactly like the static frame before it. Seeding is idempotent (a
  // StrictMode second render sees armed=true and does nothing).
  const phase: CommitPhase = done ? 'done' : loading ? 'loading' : 'idle';
  const committedPhase = useRef<CommitPhase>(phase);
  const armed = useRef(false);
  const values = useRef<MorphValues | null>(null);
  const running = useRef<Animated.CompositeAnimation | null>(null);
  const seed = (from: CommitPhase) => {
    if (values.current) return;
    const at = PHASE_TARGETS[from];
    values.current = {
      labelO: new Animated.Value(at.labelO),
      spinO: new Animated.Value(at.spinO),
      checkO: new Animated.Value(at.checkO),
      checkS: new Animated.Value(from === 'done' ? 1 : CHECK_SCALE_FROM),
      tintO: new Animated.Value(at.tintO),
    };
  };
  if (!armed.current && phase !== committedPhase.current) {
    armed.current = true;
    seed(committedPhase.current);
  }
  // A button that MOUNTS done shows its check fully opaque too (no caller does today).
  const morphing = (armed.current && phase !== 'idle') || (!armed.current && phase === 'done');

  useLayoutEffect(() => {
    const from = committedPhase.current;
    const v = values.current;
    if (!armed.current || !v || from === phase) {
      committedPhase.current = phase;
      return;
    }
    running.current?.stop();
    running.current = null;
    const to = PHASE_TARGETS[phase];
    if (phase === 'done') {
      if (Platform.OS === 'ios') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      if (Platform.OS !== 'web') {
        AccessibilityInfo.announceForAccessibility?.(`${label}: done`);
      }
    }
    if (reducedMotion()) {
      v.labelO.setValue(to.labelO);
      v.spinO.setValue(to.spinO);
      v.checkO.setValue(to.checkO);
      v.tintO.setValue(to.tintO);
      v.checkS.setValue(phase === 'done' ? 1 : CHECK_SCALE_FROM);
      committedPhase.current = phase;
      return;
    }
    // done → idle settles slowly; arriving at done fades the fill in over
    // SETTLE_MS while the layers cross-fade over MORPH_MS; the rest is MORPH_MS.
    const settleBack = from === 'done' && phase === 'idle';
    const fade = (value: Animated.Value, toValue: number, duration: number) =>
      Animated.timing(value, {
        toValue,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: nativeDriver,
      });
    const layerMs = settleBack ? SETTLE_MS : MORPH_MS;
    const parts: Animated.CompositeAnimation[] = [
      fade(v.labelO, to.labelO, layerMs),
      fade(v.spinO, to.spinO, layerMs),
      fade(v.checkO, to.checkO, layerMs),
      fade(v.tintO, to.tintO, phase === 'done' || settleBack ? SETTLE_MS : MORPH_MS),
    ];
    if (phase === 'done') {
      parts.push(
        Animated.spring(v.checkS, {
          toValue: 1,
          useNativeDriver: nativeDriver,
          ...Tokens.motion.spring.snap,
        }),
      );
    }
    const anim = Animated.parallel(parts);
    running.current = anim;
    anim.start(({ finished }) => {
      if (running.current === anim) running.current = null;
      // The check is invisible now: reset its scale for the next landing.
      if (finished && phase !== 'done') v.checkS.setValue(CHECK_SCALE_FROM);
    });
    committedPhase.current = phase;
    // label is read for the announcement only; the effect runs on a phase change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => () => {
    running.current?.stop();
  }, []);

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
    isDisabled && !morphing && styles.disabled,
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
        // While the morph plays (armed, not idle) the spinner, check and teal
        // fill show at FULL opacity; the press stays blocked by `disabled`.
        isDisabled && !morphing && styles.disabled,
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

  const labelRow = (
    <>
      {iconLeft ? <View style={styles.iconLeft}>{iconLeft}</View> : null}
      <Text style={[styles.label, { fontSize: sz.fontSize, color: textColor }]}>
        {label}
      </Text>
      {iconRight ? <View style={styles.iconRight}>{iconRight}</View> : null}
    </>
  );
  const checkIcon = (
    <Check
      size={sz.fontSize + 4}
      strokeWidth={2.5}
      color={variant === 'primary' || variant === 'destructive' ? '#FFFFFF' : colors.success}
    />
  );

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
        accessibilityState={armed.current ? { disabled: isDisabled, busy: phase === 'loading' } : { disabled: isDisabled }}
      >
        {armed.current && values.current ? (
          // THE ARMED TREE. The label row stays laid out (so the width never
          // moves) and stays readable by VoiceOver (its Text names the
          // button); only the tint, spinner and check layers are hidden from
          // accessibility and never take a touch.
          <>
            {variant === 'primary' ? (
              <Animated.View
                pointerEvents="none"
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
                style={[styles.tint, { opacity: values.current.tintO }]}
              />
            ) : null}
            <Animated.View style={[styles.row, { opacity: values.current.labelO }]}>
              {labelRow}
            </Animated.View>
            {/* Kept mounted once armed so it fades out instead of cutting;
                it only spins while loading. */}
            <Animated.View
              pointerEvents="none"
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
              style={[styles.spinnerOverlay, { opacity: values.current.spinO }]}
            >
              <ActivityIndicator color={textColor} animating={phase === 'loading'} hidesWhenStopped={false} />
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
              style={[styles.spinnerOverlay, { opacity: values.current.checkO, transform: [{ scale: values.current.checkS }] }]}
            >
              {checkIcon}
            </Animated.View>
          </>
        ) : (
          // THE STATIC TREE (nothing has changed since mount). Loading keeps
          // the label row (invisible) so the button holds its width, and the
          // spinner sits over it — on the phone too now, so a hugging button
          // no longer shrinks to a spinner and back.
          <>
            <View style={loading || done ? [styles.row, styles.labelHidden] : styles.row}>
              {labelRow}
            </View>
            {phase === 'loading' ? (
              <View pointerEvents="none" style={styles.spinnerOverlay}>
                <ActivityIndicator color={textColor} />
              </View>
            ) : phase === 'done' ? (
              <View
                pointerEvents="none"
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
                style={styles.spinnerOverlay}
              >
                {checkIcon}
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
    // The commit morph's colour: equipment green → teal, faded in over the
    // primary fill. Same pill radius, so it never shows a corner.
    tint: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: Tokens.radius.full,
      backgroundColor: t.success,
    },
    // Desktop-web hover (see pressableStyle).
    hoverFill: { filter: 'brightness(0.94)' },
    hoverQuiet: { backgroundColor: t.surfaceAlt },
    hoverGhost: { backgroundColor: t.neutralSoft },
    iconLeft: { marginRight: 8 },
    iconRight: { marginLeft: 8 },
  });

/**
 * Commit feedback for a Button: `const c = useCommitFeedback();` then
 * `<Button loading={c.loading} done={c.done} onPress={() => c.run(save)} />`.
 * run() shows the spinner, then the check for `holdMs`, then the label again;
 * a failure goes straight back to the label and rethrows.
 *
 * Use it only where the screen STAYS after success. A commit that navigates
 * away never shows the check — the toast (nailIt) covers that one.
 *
 * The busyRef guard, not React state, is what stops a double tap inside one
 * frame from running the work twice. Nothing is set after unmount.
 */
export function useCommitFeedback(holdMs: number = COMMIT_HOLD_MS): {
  loading: boolean;
  done: boolean;
  busy: boolean;
  run: <T>(work: () => Promise<T>) => Promise<T | undefined>;
} {
  const [phase, setPhase] = useState<CommitPhase>('idle');
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  const run = useCallback(
    async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
      if (busyRef.current) return undefined;
      busyRef.current = true;
      if (mountedRef.current) setPhase('loading');
      try {
        const r = await work();
        if (mountedRef.current) {
          setPhase('done');
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            busyRef.current = false;
            if (mountedRef.current) setPhase('idle');
          }, holdMs);
        } else busyRef.current = false;
        return r;
      } catch (e) {
        busyRef.current = false;
        if (mountedRef.current) setPhase('idle');
        throw e;
      }
    },
    [holdMs],
  );

  return { loading: phase === 'loading', done: phase === 'done', busy: phase !== 'idle', run };
}

export default Button;
