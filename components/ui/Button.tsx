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
//
// THE BUSY STATE (the Level, loader wave). The instant `loading` turns true
// the press is blocked and accessibilityState.busy is true — both from the
// PROP, never from the delayed visual. The busy VISUAL waits
// LOADER.button.revealMs (120 ms), baked into the easing (a plateau, no JS
// timer): the label fades and lifts 4 pt from +120 to +240, the level fades
// in from +180 to +340. Work that finishes inside the 120 ms shows NO busy
// visual at all — just the press. Once shown it holds at least
// LOADER.button.minHoldMs (400 ms, one timer for the remainder) before the
// done morph or the return to the label; the press stays blocked through that
// hold while busy already reads false. The busy layer is CORE's LevelMark
// (tone onAccent), which only subscribes to the shared clock while the busy
// visual is on. No per-press haptic any more (the tick on every tap was
// noise); the done morph fires haptic.success() through utils/haptics, which
// de-dupes it against the toast's.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  Animated,
  AccessibilityInfo,
  Easing,
  View,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Check } from 'lucide-react-native';
import { Layout, Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import LevelMark from '@/components/loaders/LevelMark';
import { haptic } from '@/utils/haptics';
import { ACCELERATE, DECELERATE, LOADER, linear, plateau } from '@/utils/levelTimeline';
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

// The busy visual's own motion, after LOADER.button.revealMs (120 ms):
/** The label fades out and lifts over this (so it is gone at +240). */
const BUSY_LABEL_FADE_MS = 120;
/** The label's lift, pt (upwards). */
const BUSY_LABEL_LIFT = -4;
/** The level starts this long after the label (+180)… */
const BUSY_LEVEL_LAG_MS = 60;
/** …and fades in over this (fully in at +340). */
const BUSY_LEVEL_FADE_MS = 160;

/**
 * `loading` ended at `now` after it began at `loadingAt`. The busy visual
 * appears at loadingAt + LOADER.button.revealMs; work that ended before that
 * was never shown (no hold, no visual). Once shown it holds until shownAt +
 * LOADER.button.minHoldMs — holdMs is what remains of that hold.
 */
export function busyExit(loadingAt: number, now: number): { shown: boolean; holdMs: number } {
  const shownAt = loadingAt + LOADER.button.revealMs;
  if (now < shownAt) return { shown: false, holdMs: 0 };
  return { shown: true, holdMs: Math.max(0, shownAt + LOADER.button.minHoldMs - now) };
}

type CommitPhase = 'idle' | 'loading' | 'done';
type MorphValues = {
  labelO: Animated.Value;
  labelY: Animated.Value;
  spinO: Animated.Value;
  checkO: Animated.Value;
  checkS: Animated.Value;
  tintO: Animated.Value;
};
/**
 * The busy bookkeeping, stepped DURING render (React's derived-state
 * pattern) so the render that sees `loading` flip already carries it:
 *   episode    +1 each time `loading` goes false → true (the level's key: a
 *              fresh drift-in per press). A restart while the hold is still
 *              up keeps the episode (the level is on screen; no remount).
 *   loadingAt  when this busy episode began.
 *   tail       the busy visual outlives `loading` (it was shown): through the
 *              hold and the fade-out, cleared when the fade-out completes.
 *   holdUntil  > 0 while the minimum hold runs (the press stays blocked).
 */
type BusyState = { episode: number; loadingAt: number; tail: boolean; holdUntil: number };
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
      labelY: new Animated.Value(0),
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

  // ── The busy bookkeeping (see BusyState), stepped during render. ──
  const [busyState, setBusyState] = useState<BusyState>(() => ({
    episode: 0,
    loadingAt: phase === 'loading' ? Date.now() : 0,
    tail: false,
    holdUntil: 0,
  }));
  const [busyPhase, setBusyPhase] = useState<CommitPhase>(phase);
  let busy = busyState;
  if (phase !== busyPhase) {
    const now = Date.now();
    if (phase === 'loading') {
      busy = busyState.holdUntil > 0
        ? { ...busyState, tail: false, holdUntil: 0 }
        : { episode: busyState.episode + 1, loadingAt: now, tail: false, holdUntil: 0 };
    } else if (busyPhase === 'loading') {
      const exit = busyExit(busyState.loadingAt, now);
      busy = { ...busyState, tail: exit.shown, holdUntil: exit.holdMs > 0 ? now + exit.holdMs : 0 };
    }
    setBusyPhase(phase);
    if (busy !== busyState) setBusyState(busy);
  }
  /** The busy visual is on: from the press until its fade-out completes (the level's clock runs only then). */
  const busyVisual = armed.current && (phase === 'loading' || busy.tail);
  /** The minimum hold is running: the press stays blocked, busy already reads false. */
  const holdActive = busy.holdUntil > 0;

  /** The phase the layers show (or are heading to) — behind the prop through a hold. */
  const visual = useRef<CommitPhase>(phase);
  /** The latest prop phase, for the hold timer. */
  const latestPhase = useRef<CommitPhase>(phase);
  latestPhase.current = phase;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The busy visual was entered through the armed path (enterBusy) at least
   *  once. False only for the episode a Button MOUNTED into: that one never ran
   *  the busy timings, so there is nothing to snap back from. */
  const enteredBusy = useRef(false);
  const mounted = useRef(true);
  /** The busy visual's fade-out completed: the level stops holding a clock. */
  const endTail = useCallback(() => {
    if (!mounted.current) return;
    setBusyState((s) => (s.tail || s.holdUntil > 0 ? { ...s, tail: false, holdUntil: 0 } : s));
  }, []);

  useLayoutEffect(() => {
    const from = committedPhase.current;
    const v = values.current;
    if (!armed.current || !v || from === phase) {
      committedPhase.current = phase;
      visual.current = phase;
      return;
    }
    committedPhase.current = phase;
    if (holdTimer.current != null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }

    /** The busy visual: label out and up from +120, the level in from +180 (plateaus, no timer). */
    const enterBusy = () => {
      enteredBusy.current = true;
      running.current?.stop();
      running.current = null;
      visual.current = 'loading';
      const B = LOADER.button;
      const fade = (value: Animated.Value, toValue: number) =>
        Animated.timing(value, { toValue, duration: MORPH_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver });
      let parts: Animated.CompositeAnimation[];
      if (reducedMotion()) {
        // No translate; the reveal still waits 120 ms (it is about flashes, not
        // motion): each layer jumps at the END of one 120 ms timing.
        const jump = (value: Animated.Value, toValue: number) =>
          Animated.timing(value, { toValue, duration: B.revealMs, easing: plateau(1, linear), useNativeDriver: nativeDriver });
        v.labelY.setValue(0);
        parts = [jump(v.labelO, 0), jump(v.spinO, 1), fade(v.checkO, 0), fade(v.tintO, 0)];
      } else {
        const labelMs = B.revealMs + BUSY_LABEL_FADE_MS;
        const levelAt = B.revealMs + BUSY_LEVEL_LAG_MS;
        const levelMs = levelAt + BUSY_LEVEL_FADE_MS;
        const labelOut = (value: Animated.Value, toValue: number) =>
          Animated.timing(value, { toValue, duration: labelMs, easing: plateau(B.revealMs / labelMs, ACCELERATE), useNativeDriver: nativeDriver });
        parts = [
          labelOut(v.labelO, 0),
          labelOut(v.labelY, BUSY_LABEL_LIFT),
          Animated.timing(v.spinO, { toValue: 1, duration: levelMs, easing: plateau(levelAt / levelMs, DECELERATE), useNativeDriver: nativeDriver }),
          fade(v.checkO, 0),
          fade(v.tintO, 0),
        ];
      }
      const anim = Animated.parallel(parts);
      running.current = anim;
      anim.start(() => {
        if (running.current === anim) running.current = null;
      });
    };

    /** Today's morph, from what the layers show to `target` (the done morph or back to the label). */
    const runTo = (target: CommitPhase) => {
      const was = visual.current;
      running.current?.stop();
      running.current = null;
      visual.current = target;
      const to = PHASE_TARGETS[target];
      if (target === 'done') {
        if (Platform.OS === 'ios') {
          haptic.success();
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
        v.labelY.setValue(0);
        v.checkS.setValue(target === 'done' ? 1 : CHECK_SCALE_FROM);
        endTail();
        return;
      }
      // done → idle settles slowly; arriving at done fades the fill in over
      // SETTLE_MS while the layers cross-fade over MORPH_MS; the rest is MORPH_MS.
      const settleBack = was === 'done' && target === 'idle';
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
        fade(v.labelY, 0, layerMs),
        fade(v.spinO, to.spinO, layerMs),
        fade(v.checkO, to.checkO, layerMs),
        fade(v.tintO, to.tintO, target === 'done' || settleBack ? SETTLE_MS : MORPH_MS),
      ];
      if (target === 'done') {
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
        if (!finished) return;
        // The check is invisible now: reset its scale for the next landing.
        if (target !== 'done') v.checkS.setValue(CHECK_SCALE_FROM);
        // The level has faded out: it stops holding the shared clock.
        endTail();
      });
    };

    if (phase === 'loading') {
      enterBusy();
      return;
    }
    if (visual.current === 'loading') {
      if (!busy.tail && enteredBusy.current) {
        // `loading` ended inside the 120 ms reveal: the timings are still in
        // their plateaus (idle values) — stop them and snap. No busy visual.
        running.current?.stop();
        running.current = null;
        v.labelO.setValue(1);
        v.labelY.setValue(0);
        v.spinO.setValue(0);
        visual.current = 'idle';
        if (phase === 'done') runTo('done');
        return;
      }
      if (!busy.tail) {
        // The Button MOUNTED loading and it ended inside the 120 ms reveal:
        // the static frame had the label hidden and the level still inside its
        // own reveal plateau (invisible). Keep the label where the static frame
        // had it (0) and the level unshown, then run today's morph from there —
        // the first armed frame matches the static frame before it.
        v.spinO.setValue(0);
      }
      if (busy.holdUntil > 0) {
        // Shown, but not for 400 ms yet: hold the busy visual for the rest,
        // then morph to whatever the prop says by then.
        holdTimer.current = setTimeout(() => {
          holdTimer.current = null;
          if (!mounted.current) return;
          setBusyState((s) => (s.holdUntil > 0 ? { ...s, holdUntil: 0 } : s));
          runTo(latestPhase.current);
        }, Math.max(0, busy.holdUntil - Date.now()));
        return;
      }
    }
    runTo(phase);
    // label is read for the announcement only and busy is this render's; the
    // effect runs on a phase change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (holdTimer.current != null) clearTimeout(holdTimer.current);
      holdTimer.current = null;
      running.current?.stop();
    };
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
  // No per-press haptic: a tick on every tap is noise. Tabs, segments,
  // toggles and pickers keep their own selection tick.
  const handlePress = () => {
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
        disabled={isDisabled || holdActive}
        style={pressableStyle}
        testID={testID}
        accessibilityRole="button"
        accessibilityState={armed.current ? { disabled: isDisabled || holdActive, busy: phase === 'loading' } : { disabled: isDisabled }}
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
            <Animated.View style={[styles.row, { opacity: values.current.labelO, transform: [{ translateY: values.current.labelY }] }]}>
              {labelRow}
            </Animated.View>
            {/* Kept mounted once armed so it fades out instead of cutting.
                spinO owns the level's reveal and exit (revealDelayMs 0, exit
                none); it holds the shared clock only while the busy visual is
                on, and a new key per press gives each press a fresh drift-in. */}
            <Animated.View
              pointerEvents="none"
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
              style={[styles.spinnerOverlay, { opacity: values.current.spinO }]}
            >
              <LevelMark
                key={busy.episode}
                size={20}
                tone="onAccent"
                color={textColor}
                revealDelayMs={0}
                exit="none"
                animate={busyVisual}
              />
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
                {/* Mounted loading: no spinO here, so the level's own 120 ms plateau is the reveal. */}
                <LevelMark size={20} tone="onAccent" color={textColor} revealDelayMs={LOADER.button.revealMs} exit="none" />
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
      // fill must clear 4.5:1 for white. accentFill is that solved fill: the
      // brand green #2F6B3A (white 6.39:1) in light, and a mid green in dark,
      // where the dark-theme accent #5DB36E is too light to carry white. Shadow
      // stays the accent — a shadow carries no text, so 4.5:1 does not apply.
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
      const startedAt = Date.now();
      if (mountedRef.current) setPhase('loading');
      try {
        const r = await work();
        if (mountedRef.current) {
          setPhase('done');
          // The Button may still be holding its busy visual (the 400 ms
          // minimum) before the check lands: the check's hold starts after it.
          const busyHold = busyExit(startedAt, Date.now()).holdMs;
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            busyRef.current = false;
            if (mountedRef.current) setPhase('idle');
          }, holdMs + busyHold);
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
