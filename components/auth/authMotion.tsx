// authMotion.tsx — motion for the front door (sign in / sign up).
//
// Lane A1 (slick round 3) owns the ENTRANCE part below: useLaunchEntrance,
// Slot and useLaunchTarget. Lane A2 appends the form motion after it.
//
// THE ENTRANCE. On a cold start BrandSplash covers the app with ink, then hands
// off: its "MAGE ID" flies onto this screen's own wordmark and the ink
// dissolves while the screen's blocks rise in on a short stagger. The screen
// is under the ink while it waits, so its blocks start hidden without a flash.
//
// AT REST NOTHING CHANGES. The entrance arms only if the screen's FIRST render
// sees the launch curtain down ('covered' / 'lifting'). Mounted any other time
// (a push from login to signup, a hot reload, jest, a later visit) it is
// unarmed for life: slot() is null, the wordmark shows, the tree is identical
// to the screen without this hook. Reduce Motion never arms it.
//
// NOTHING STAYS HIDDEN. The curtain heals itself to 'open' (launchCurtain.ts);
// 'open' before the stagger ran snaps every block to rest, and a local timer
// does the same (and re-renders) even if no notification ever arrives.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, StyleSheet, Text, TouchableOpacity,
  type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';
import { Check } from 'lucide-react-native';
import { Motion } from '@/constants/designTokens';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { nativeDriver, reducedMotion } from '@/components/ui/motion';
import {
  LAUNCH_STALE_MS,
  getLaunchPhase,
  getLaunchTarget,
  registerLaunchTarget,
  useLaunchPhase,
  type LaunchRect,
} from '@/components/launch/launchCurtain';

// hoist into Motion.duration after round 3
const ENTRANCE_START_MS = 120;
// hoist into Motion.duration after round 3
const ENTRANCE_STEP_MS = 40;
// hoist into Motion.duration after round 3
const ENTRANCE_FADE_MS = 200;
const ENTRANCE_RISE = 12;
const MAX_SLOTS = 10;

interface SlotValues { opacity: Animated.Value; translateY: Animated.Value; style: ViewStyle }

export interface LaunchEntrance {
  /** True when this screen's first render saw the launch curtain down. */
  armed: boolean;
  /** The i-th block's entrance style, or null (unarmed, or i ≥ 10). */
  slot: (i: number) => ViewStyle | null;
  /** False only while the splash wordmark is still flying onto this one. */
  showWordmark: boolean;
}

export function useLaunchEntrance(count: number): LaunchEntrance {
  // Decided ONCE, at the first render.
  const [armed] = useState(() => {
    const p = getLaunchPhase();
    return (p === 'covered' || p === 'lifting') && !reducedMotion();
  });
  const [values] = useState<SlotValues[] | null>(() => {
    if (!armed) return null;
    return Array.from({ length: Math.min(Math.max(0, count), MAX_SLOTS) }, () => {
      const opacity = new Animated.Value(0);
      const translateY = new Animated.Value(ENTRANCE_RISE);
      return { opacity, translateY, style: { opacity, transform: [{ translateY }] } };
    });
  });
  const [healed, setHealed] = useState(false);
  const phase = useLaunchPhase();
  const doneRef = useRef(!armed);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const rest = useCallback(() => {
    animRef.current?.stop();
    values?.forEach((v) => { v.opacity.setValue(1); v.translateY.setValue(0); });
  }, [values]);

  useEffect(() => {
    if (!armed || doneRef.current || !values) return;
    if (phase === 'open' || reducedMotion()) {
      doneRef.current = true;
      rest();
      return;
    }
    if (phase !== 'lifting' && phase !== 'landed') return;
    doneRef.current = true;
    const anim = Animated.parallel(values.map((v, i) => Animated.sequence([
      Animated.delay(ENTRANCE_START_MS + i * ENTRANCE_STEP_MS),
      Animated.parallel([
        Animated.timing(v.opacity, {
          toValue: 1, duration: ENTRANCE_FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
        }),
        Animated.spring(v.translateY, { toValue: 0, ...Motion.spring.rise, useNativeDriver: nativeDriver }),
      ]),
    ])));
    animRef.current = anim;
    // An interrupted stagger lands at rest, never part-way.
    anim.start(({ finished }) => { if (!finished) values.forEach((v) => { v.opacity.setValue(1); v.translateY.setValue(0); }); });
  }, [armed, phase, values, rest]);

  // Second guard: even with no notification at all, nothing stays hidden.
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => {
      if (!doneRef.current) {
        doneRef.current = true;
        rest();
      }
      // Only while the curtain is still stuck 'covered'. A 'lifting' phase
      // always lands within FLY_CAP_MS (and the curtain heals itself), so
      // un-hiding here would show the real wordmark before the flying one
      // arrives on a slow cold start.
      if (getLaunchPhase() === 'covered') setHealed(true);
    }, LAUNCH_STALE_MS);
    return () => clearTimeout(t);
  }, [armed, rest]);

  useEffect(() => () => { animRef.current?.stop(); }, []);

  const slot = useCallback(
    (i: number): ViewStyle | null => (values && i >= 0 && i < values.length ? values[i].style : null),
    [values],
  );

  const showWordmark = !armed || healed || phase === 'landed' || phase === 'open';
  return { armed, slot, showWordmark };
}

/** Wraps children in an Animated.View only when a style is given. */
export function Slot({ style, children }: { style: ViewStyle | null; children: React.ReactNode }) {
  if (!style) return <>{children}</>;
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * The screen's "MAGE ID" Text: reports its window rect to the launch curtain
 * so the splash wordmark can fly onto it. Registers only while a launch is in
 * progress; on unmount it clears the rect only if it is still this one.
 *
 * Spread `layoutProps` onto the Text: it carries `onLayout` ONLY when this
 * screen's first render saw the curtain down, and is an empty object otherwise,
 * so the unarmed Text has exactly the props it had before (a full-tree snapshot
 * prints a function prop).
 */
export function useLaunchTarget(): {
  ref: React.RefObject<Text | null>;
  onLayout: (e: LayoutChangeEvent) => void;
  layoutProps: { onLayout?: (e: LayoutChangeEvent) => void };
} {
  const [live] = useState(() => getLaunchPhase() !== 'open');
  const ref = useRef<Text | null>(null);
  const mineRef = useRef<LaunchRect | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (mineRef.current && getLaunchTarget() === mineRef.current) registerLaunchTarget(null);
      mineRef.current = null;
    };
  }, []);

  const onLayout = useCallback((_e: LayoutChangeEvent) => {
    if (getLaunchPhase() === 'open') return;
    const measure = () => {
      const node = ref.current as unknown as {
        measureInWindow?: (cb: (x: number, y: number, width: number, height: number) => void) => void;
      } | null;
      if (!aliveRef.current || !node?.measureInWindow) return;
      node.measureInWindow((x, y, width, height) => {
        if (!aliveRef.current) return;
        const rect = { x, y, width, height };
        registerLaunchTarget(rect);
        if (getLaunchTarget() === rect) mineRef.current = rect;
      });
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure);
    else measure();
  }, []);

  const layoutProps = useMemo(() => (live ? { onLayout } : {}), [live, onLayout]);
  return { ref, onLayout, layoutProps };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lane A2 (slick round 3) — the form motion: focus rings, the commit morph on
// the screens' own submit buttons, the press spring.
//
// Same contract as the entrance: AT REST NOTHING CHANGES. A ring renders
// nothing, and a button renders exactly the tree it rendered before this lane,
// until a change is OBSERVED after mount (a focus, an error, a submit). Reduce
// Motion makes every value jump; the state still changes.
// ─────────────────────────────────────────────────────────────────────────────

// hoist into Motion.duration after round 3
const RING_MS = 140;
// hoist into Motion.duration after round 3
const MORPH_MS = 140;
// hoist into Motion.duration after round 3
const SETTLE_MS = 200;
const CHECK_SCALE_FROM = 0.6;
const PRESS_SCALE = 0.97;

const makeRingStyles = (t: ThemeColors) => StyleSheet.create({
  ring: {
    position: 'absolute',
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderWidth: 1.5,
  },
  accent: { borderColor: t.accent },
  danger: { borderColor: t.danger },
});

/**
 * A focus / error ring over an input row. Render it as the LAST child of the
 * row so the TextInput never remounts. Null until `visible` or `tone` first
 * changes after mount; from then on an absolutely positioned, touch-through
 * border whose opacity eases to `visible` over RING_MS. The tone swaps at once.
 */
export function FieldRing({ visible, tone, radius }: { visible: boolean; tone: 'accent' | 'danger'; radius: number }) {
  const styles = useThemedStyles(makeRingStyles);
  const first = useRef({ visible, tone });
  const armed = useRef(false);
  const opacity = useRef<Animated.Value | null>(null);
  if (!armed.current && (visible !== first.current.visible || tone !== first.current.tone)) {
    armed.current = true;
    // Seeded where the ring WAS, so the first armed frame matches the one before.
    opacity.current = new Animated.Value(first.current.visible ? 1 : 0);
  }

  useLayoutEffect(() => {
    const v = opacity.current;
    if (!v) return undefined;
    const to = visible ? 1 : 0;
    if (reducedMotion()) { v.setValue(to); return undefined; }
    const anim = Animated.timing(v, {
      toValue: to, duration: RING_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
    });
    anim.start();
    return () => anim.stop();
  }, [visible]);

  if (!armed.current || !opacity.current) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.ring, tone === 'danger' ? styles.danger : styles.accent, { borderRadius: radius + 1, opacity: opacity.current }]}
    />
  );
}

export type SubmitPhase = 'idle' | 'loading' | 'done';
type MorphValues = { labelO: Animated.Value; spinO: Animated.Value; checkO: Animated.Value; checkS: Animated.Value };
const PHASE_TARGETS: Record<SubmitPhase, { labelO: number; spinO: number; checkO: number }> = {
  idle: { labelO: 1, spinO: 0, checkO: 0 },
  loading: { labelO: 0, spinO: 1, checkO: 0 },
  done: { labelO: 0, spinO: 0, checkO: 1 },
};

const morphStyles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});

export interface AuthSubmitButtonProps {
  phase: SubmitPhase;
  label: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  style: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
  spinnerColor: string;
  onPress: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  disabled?: boolean;
  activeOpacity?: number;
  testID?: string;
}

/**
 * The commit morph (label → spinner → check) for the auth screens' OWN button
 * styles, modelled on components/ui/Button.tsx. Unarmed (the phase never
 * changed since mount) it renders exactly the tree the screen rendered before:
 * the label (with its icons), or a bare spinner if it mounted loading. The
 * first phase change arms it for good: the label row stays laid out (so the
 * button never changes size) and cross-fades with a spinner layer and a check
 * layer that springs in. The layers are hidden from accessibility; the label
 * still names the button.
 */
export function AuthSubmitButton({
  phase, label, leading, trailing, style, textStyle, spinnerColor,
  onPress, onPressIn, onPressOut, disabled, activeOpacity, testID,
}: AuthSubmitButtonProps) {
  const committed = useRef<SubmitPhase>(phase);
  const armed = useRef(false);
  const values = useRef<MorphValues | null>(null);
  const running = useRef<Animated.CompositeAnimation | null>(null);
  if (!armed.current && phase !== committed.current) {
    armed.current = true;
    const at = PHASE_TARGETS[committed.current];
    values.current = {
      labelO: new Animated.Value(at.labelO),
      spinO: new Animated.Value(at.spinO),
      checkO: new Animated.Value(at.checkO),
      checkS: new Animated.Value(committed.current === 'done' ? 1 : CHECK_SCALE_FROM),
    };
  }

  useLayoutEffect(() => {
    const from = committed.current;
    committed.current = phase;
    const v = values.current;
    if (!v || from === phase) return;
    running.current?.stop();
    running.current = null;
    const to = PHASE_TARGETS[phase];
    if (reducedMotion()) {
      v.labelO.setValue(to.labelO);
      v.spinO.setValue(to.spinO);
      v.checkO.setValue(to.checkO);
      v.checkS.setValue(phase === 'done' ? 1 : CHECK_SCALE_FROM);
      return;
    }
    const ms = from === 'done' && phase === 'idle' ? SETTLE_MS : MORPH_MS;
    const fade = (value: Animated.Value, toValue: number) => Animated.timing(value, {
      toValue, duration: ms, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
    });
    const parts = [fade(v.labelO, to.labelO), fade(v.spinO, to.spinO), fade(v.checkO, to.checkO)];
    if (phase === 'done') {
      v.checkS.setValue(CHECK_SCALE_FROM);
      parts.push(Animated.spring(v.checkS, { toValue: 1, ...Motion.spring.snap, useNativeDriver: nativeDriver }));
    }
    const anim = Animated.parallel(parts);
    running.current = anim;
    anim.start(({ finished }) => {
      if (running.current === anim) running.current = null;
      if (finished && phase !== 'done') v.checkS.setValue(CHECK_SCALE_FROM);
    });
  }, [phase]);

  useEffect(() => () => { running.current?.stop(); }, []);

  const v = values.current;
  let children: React.ReactNode;
  if (armed.current && v) {
    const gap = (StyleSheet.flatten(style) as ViewStyle | undefined)?.gap;
    children = (
      <>
        <Animated.View style={[morphStyles.row, gap != null ? { gap } : null, { opacity: v.labelO }]}>
          {leading}
          <Text style={textStyle}>{label}</Text>
          {trailing}
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[morphStyles.layer, { opacity: v.spinO }]}
        >
          <ActivityIndicator color={spinnerColor} size="small" animating={phase === 'loading'} hidesWhenStopped={false} />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[morphStyles.layer, { opacity: v.checkO, transform: [{ scale: v.checkS }] }]}
        >
          <Check size={20} color={spinnerColor} strokeWidth={2.5} />
        </Animated.View>
      </>
    );
  } else if (phase === 'loading') {
    children = <ActivityIndicator color={spinnerColor} size="small" />;
  } else if (phase === 'done') {
    children = <Check size={20} color={spinnerColor} strokeWidth={2.5} />;
  } else {
    children = (
      <>
        {leading}
        <Text style={textStyle}>{label}</Text>
        {trailing}
      </>
    );
  }

  return (
    <TouchableOpacity
      style={style}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      activeOpacity={activeOpacity}
      testID={testID}
    >
      {children}
    </TouchableOpacity>
  );
}

/**
 * A submit button's press: scale 1 → 0.97 → 1 on Motion.spring.snap (ζ≈0.83).
 * `style` goes on the Animated.View that already wraps the button (it has the
 * same shape as the transform it replaces, so the tree at rest is unchanged).
 * Reduce Motion: no scale at all.
 */
export function usePressSpring(): { style: ViewStyle; onPressIn: () => void; onPressOut: () => void } {
  const [scale] = useState(() => new Animated.Value(1));
  const style = useMemo(() => ({ transform: [{ scale }] }) as ViewStyle, [scale]);
  const onPressIn = useCallback(() => {
    if (reducedMotion()) return;
    Animated.spring(scale, { toValue: PRESS_SCALE, ...Motion.spring.snap, useNativeDriver: nativeDriver }).start();
  }, [scale]);
  const onPressOut = useCallback(() => {
    if (reducedMotion()) { scale.setValue(1); return; }
    Animated.spring(scale, { toValue: 1, ...Motion.spring.snap, useNativeDriver: nativeDriver }).start();
  }, [scale]);
  return { style, onPressIn, onPressOut };
}
