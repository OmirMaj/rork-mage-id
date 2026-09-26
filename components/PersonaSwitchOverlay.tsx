// PersonaSwitchOverlay — "the level finds center" persona-switch transition.
//
// The old version scaled a brand-orange disc over the whole screen — a
// full-bleed accent flood with unreadable text. This one stays inside the
// app's own theme: the screen dims to the theme scrim, one hairline accent
// ring ripples out from the tapped card, and the tapped card itself lifts into
// a surface card at centre with the destination icon, a readable label, and the signature move — a spirit
// level whose bubble slides in and SETTLES DEAD CENTER. Construction for
// "you've leveled into your new workspace."
//
// Timeline (~1.15s total without a hold):
//   0ms       — haptic impact, scrim fades in, the ring starts
//   90–420ms  — the card lifts out of the tapped card (originRect) and springs
//               to centre — or, with no originRect, rises from 0.92 — then the
//               icon and the eyebrow/label follow
//   300–520ms — level track draws in
//   420–780ms — bubble springs to center (the settle; no wobble, no glow)
//   onSettled — the HOLD: at T_SETTLED the overlay awaits onSettled (bounded
//               by HOLD_CAP_MS), then fades out and calls onDone()
//   930ms     — with no onSettled: overlay fades out; onDone() at ~1150ms
//
// The overlay never navigates. Its own work ends at onDone: the parent
// navigates after it (persona-select), so the host outlives the fade.
//
// Reduced motion / web: a clean theme-dark crossfade, no theatrics (web keeps
// timings where native springs).
// Props are additive: originRect and onSettled are optional.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { HardHat, Home, Repeat, Building2 } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Motion, Tokens } from '@/constants/designTokens';
import { nativeDriver } from '@/components/ui/motion';
import type { ThemeColors } from '@/constants/colors';
import type { UserRole } from '@/utils/onboardingProfile';
import { USER_ROLE_LABELS } from '@/utils/onboardingProfile';

// ── Constants ─────────────────────────────────────────────────────────────────

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const SCREEN_DIAGONAL = Math.ceil(Math.sqrt(SCREEN_W * SCREEN_W + SCREEN_H * SCREEN_H));

// Rings render at a fixed base size and scale outward past the diagonal.
const RING_SIZE = 140;
const RING_COVER_SCALE = (SCREEN_DIAGONAL * 2.1) / RING_SIZE;

// Spirit level geometry
const LEVEL_TRACK_W = 172;
const BUBBLE_W = 30;
const BUBBLE_START_X = -54; // starts off-center, settles at 0

// Timings (ms)
const T_CARD = 90;
const T_LEVEL = 300;
const T_BUBBLE = 420;
const T_FADE = 930;
const DUR_FADEOUT = 220;
/** The bubble has visibly settled: the hold point. */
const T_SETTLED = T_BUBBLE + 360; // hoist into Motion.duration after round 3
/** The longest the overlay holds for onSettled (the invite lookup alone may take 4 s). */
export const HOLD_CAP_MS = 5000; // hoist into Motion.duration after round 3
/** The morphing card's fade-in at the start of its lift. */
const DUR_CARD_IN = 120; // hoist into Motion.duration after round 3
/** Reduced motion: the settled card shows at least this long before the fade. */
const REDUCED_HOLD_MS = 420; // hoist into Motion.duration after round 3
/** If the card has not laid out by then, it rises in place (no morph). */
const MORPH_LAYOUT_WAIT_MS = 160; // hoist into Motion.duration after round 3

// The bubble finds centre: ζ = 20 / (2·√(170·0.9)) ≈ 0.81, a hair of overshoot.
const BUBBLE_SPRING = { damping: 20, stiffness: 170, mass: 0.9 }; // hoist into Motion.spring after round 3

// Icons mirroring ROLE_ICONS in persona-select.tsx
const ROLE_ICONS: Record<UserRole, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  contractor:       HardHat,
  client:           Home,
  both:             Repeat,
  property_manager: Building2,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wait = (ms: number, timers: Set<ReturnType<typeof setTimeout>>) => new Promise<void>((resolve) => {
  const id = setTimeout(() => { timers.delete(id); resolve(); }, ms);
  timers.add(id);
});

// ── Props (additive) ──────────────────────────────────────────────────────────

export interface PersonaSwitchOverlayProps {
  /** Show and drive the animation. */
  visible: boolean;
  /** Destination persona. */
  toRole: UserRole;
  /** Pixel position of tapped card center for the ring origin. */
  originPoint?: { x: number; y: number };
  /** The tapped card's window rect: the workspace card lifts out of it. */
  originRect?: { x: number; y: number; width: number; height: number };
  /** Whether reduced motion is active. */
  reduceMotion?: boolean;
  /** The HOLD: called once the level has settled; the overlay waits for it
   *  (at most HOLD_CAP_MS) before it fades. A rejection is swallowed here —
   *  the parent owns the error. */
  onSettled?: () => Promise<void> | void;
  /** Called when the overlay has faded and unmounted — the parent may navigate. */
  onDone: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PersonaSwitchOverlay({
  visible,
  toRole,
  originPoint,
  originRect,
  reduceMotion = false,
  onSettled,
  onDone,
}: PersonaSwitchOverlayProps) {
  const { colors: t } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The latest callbacks, read after awaits (the parent may re-render mid-hold).
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const originRectRef = useRef(originRect);
  originRectRef.current = originRect;

  // Alive = this component is mounted. Every post-await step checks it.
  const aliveRef = useRef(true);
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const runningRef = useRef<Animated.CompositeAnimation[]>([]);
  const run = (anim: Animated.CompositeAnimation, done?: Animated.EndCallback) => {
    runningRef.current.push(anim);
    anim.start(done);
  };

  // Animated values
  const scrimOpacity   = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const ring1Scale     = useRef(new Animated.Value(0.2)).current;
  const ring1Opacity   = useRef(new Animated.Value(0)).current;
  const cardOpacity    = useRef(new Animated.Value(0)).current;
  const cardScale      = useRef(new Animated.Value(0.92)).current;
  const morph          = useRef(new Animated.Value(0)).current;
  const iconScale      = useRef(new Animated.Value(0.7)).current;
  const iconOpacity    = useRef(new Animated.Value(0)).current;
  const labelOpacity   = useRef(new Animated.Value(0)).current;
  const labelTranslate = useRef(new Animated.Value(8)).current;
  const trackScaleX    = useRef(new Animated.Value(0)).current;
  const bubbleX        = useRef(new Animated.Value(BUBBLE_START_X)).current;

  // The morph's start, from the card's own layout: offset to the tapped card's
  // centre and its width ratio. null = the plain rise-in-place.
  const [morphFrom, setMorphFrom] = useState<null | { dx: number; dy: number; s0: number }>(null);
  const cardLaunchedRef = useRef(false);

  const resetAnimations = useCallback(() => {
    scrimOpacity.setValue(0);
    overlayOpacity.setValue(1);
    ring1Scale.setValue(0.2);
    ring1Opacity.setValue(0);
    cardOpacity.setValue(0);
    cardScale.setValue(0.92);
    morph.setValue(0);
    iconScale.setValue(0.7);
    iconOpacity.setValue(0);
    labelOpacity.setValue(0);
    labelTranslate.setValue(8);
    trackScaleX.setValue(0);
    bubbleX.setValue(BUBBLE_START_X);
  }, [scrimOpacity, overlayOpacity, ring1Scale, ring1Opacity, cardOpacity, cardScale, morph, iconScale, iconOpacity, labelOpacity, labelTranslate, trackScaleX, bubbleX]);

  useEffect(() => {
    if (visible) {
      resetAnimations();
      cardLaunchedRef.current = false;
      setMorphFrom(null);
      setMounted(true);
    }
  }, [visible, resetAnimations]);

  // Unmount: stop everything, clear every timer, and let no await continue.
  useEffect(() => {
    aliveRef.current = true;
    const timers = timersRef.current;
    return () => {
      aliveRef.current = false;
      timers.forEach(clearTimeout);
      timers.clear();
      runningRef.current.forEach((a) => a.stop());
      runningRef.current = [];
    };
  }, []);

  const finish = useCallback(() => {
    if (!aliveRef.current) return;
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setMounted(false);
    onDoneRef.current();
  }, []);

  /** Await onSettled (bounded by HOLD_CAP_MS; a rejection is the parent's),
   *  at least `minMs` long. */
  const holdForSettled = useCallback(async (minMs: number) => {
    const settle = onSettledRef.current;
    const timers = timersRef.current;
    const settled = settle
      ? (async () => { await settle(); })().catch(() => { /* the parent owns the error */ })
      : Promise.resolve();
    await Promise.all([
      Promise.race([settled, wait(HOLD_CAP_MS, timers)]),
      minMs > 0 ? wait(minMs, timers) : Promise.resolve(),
    ]);
  }, []);

  // The card: 0 → 1 opacity, and either the morph from the tapped card or the
  // 0.92 → 1 rise. Launched once, from the card's layout (or the fallback).
  const launchCard = useCallback((from: null | { dx: number; dy: number; s0: number }) => {
    if (cardLaunchedRef.current || !aliveRef.current) return;
    cardLaunchedRef.current = true;
    const springy = Platform.OS !== 'web';
    if (from) {
      setMorphFrom(from);
      run(Animated.parallel([
        Animated.timing(cardOpacity, { toValue: 1, duration: DUR_CARD_IN, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }),
        Animated.spring(morph, { toValue: 1, ...Motion.spring.rise, useNativeDriver: nativeDriver }),
      ]));
      return;
    }
    run(Animated.sequence([
      Animated.delay(T_CARD),
      Animated.parallel([
        Animated.timing(cardOpacity, { toValue: 1, duration: 170, easing: Easing.out(Easing.ease), useNativeDriver: nativeDriver }),
        springy
          ? Animated.spring(cardScale, { toValue: 1, ...Motion.spring.rise, useNativeDriver: nativeDriver })
          : Animated.timing(cardScale, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }),
      ]),
    ]));
  }, [cardOpacity, cardScale, morph]);

  const onCardLayout = useCallback((e: LayoutChangeEvent) => {
    const rect = originRectRef.current;
    if (cardLaunchedRef.current || reduceMotion || !rect) return;
    const { x, y, width, height } = e.nativeEvent.layout;
    if (!(width > 0 && height > 0)) return;
    launchCard({
      dx: rect.x + rect.width / 2 - (x + width / 2),
      dy: rect.y + rect.height / 2 - (y + height / 2),
      s0: clamp(rect.width / width, 0.6, 1.6),
    });
  }, [reduceMotion, launchCard]);

  useEffect(() => {
    if (!mounted) return;

    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    if (reduceMotion) {
      // Reduced motion: theme-dark crossfade only.
      cardLaunchedRef.current = true;
      scrimOpacity.setValue(1);
      cardOpacity.setValue(1);
      cardScale.setValue(1);
      iconOpacity.setValue(1);
      iconScale.setValue(1);
      labelOpacity.setValue(1);
      labelTranslate.setValue(0);
      trackScaleX.setValue(1);
      bubbleX.setValue(0);
      void (async () => {
        await holdForSettled(REDUCED_HOLD_MS);
        if (!aliveRef.current) return;
        run(Animated.timing(overlayOpacity, { toValue: 0, duration: 280, easing: Easing.out(Easing.ease), useNativeDriver: nativeDriver }), finish);
      })();
      return;
    }

    const springy = Platform.OS !== 'web';
    const holding = !!onSettledRef.current;

    // The card lifts out of the tapped card once it has laid out; with no
    // originRect (or no layout in time) it rises in place.
    if (!originRectRef.current) launchCard(null);
    else {
      const timers = timersRef.current;
      const id = setTimeout(() => { timers.delete(id); launchCard(null); }, MORPH_LAYOUT_WAIT_MS);
      timers.add(id);
    }

    const legs: Animated.CompositeAnimation[] = [
      // Scrim settles in fast — the app dims into its own theme, no color flood.
      Animated.timing(scrimOpacity, { toValue: 1, duration: 150, easing: Easing.out(Easing.ease), useNativeDriver: nativeDriver }),

      // One hairline ring ripples out from the tapped card.
      Animated.parallel([
        Animated.timing(ring1Scale, { toValue: RING_COVER_SCALE, duration: 760, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }),
        Animated.sequence([
          Animated.timing(ring1Opacity, { toValue: 0.35, duration: 90, useNativeDriver: nativeDriver }),
          Animated.timing(ring1Opacity, { toValue: 0, duration: 640, easing: Easing.out(Easing.ease), useNativeDriver: nativeDriver }),
        ]),
      ]),

      // Icon springs in just behind the card.
      Animated.sequence([
        Animated.delay(T_CARD + 70),
        Animated.parallel([
          Animated.timing(iconOpacity, { toValue: 1, duration: 180, easing: Easing.out(Easing.ease), useNativeDriver: nativeDriver }),
          springy
            ? Animated.spring(iconScale, { toValue: 1, ...Motion.spring.snap, useNativeDriver: nativeDriver })
            : Animated.timing(iconScale, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }),
        ]),
      ]),

      // Eyebrow + label rise in.
      Animated.sequence([
        Animated.delay(T_CARD + 130),
        Animated.parallel([
          Animated.timing(labelOpacity, { toValue: 1, duration: 200, easing: Easing.out(Easing.ease), useNativeDriver: nativeDriver }),
          Animated.timing(labelTranslate, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }),
        ]),
      ]),

      // The level draws, then the bubble settles dead center.
      Animated.sequence([
        Animated.delay(T_LEVEL),
        Animated.timing(trackScaleX, { toValue: 1, duration: 210, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }),
      ]),
      Animated.sequence([
        Animated.delay(T_BUBBLE),
        springy
          ? Animated.spring(bubbleX, { toValue: 0, ...BUBBLE_SPRING, useNativeDriver: nativeDriver })
          : Animated.timing(bubbleX, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }),
      ]),
    ];

    if (holding) {
      // HOLD, THEN RELEASE: the fade is not part of the main parallel.
      run(Animated.parallel(legs));
      void (async () => {
        await wait(T_SETTLED, timersRef.current);
        if (!aliveRef.current) return;
        await holdForSettled(0);
        if (!aliveRef.current) return;
        run(Animated.timing(overlayOpacity, { toValue: 0, duration: DUR_FADEOUT, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }), finish);
      })();
      return;
    }

    // No hold: today's single timeline — fade out and hand back to the app.
    run(Animated.parallel([
      ...legs,
      Animated.sequence([
        Animated.delay(T_FADE),
        Animated.timing(overlayOpacity, { toValue: 0, duration: DUR_FADEOUT, easing: Easing.in(Easing.ease), useNativeDriver: nativeDriver }),
      ]),
    ]), finish);
  }, [mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mounted) return null;

  const ToIcon = ROLE_ICONS[toRole];
  const label = USER_ROLE_LABELS[toRole];
  const styles = makeStyles(t);

  // Ring origin — the tapped card's center; falls back to screen center.
  const ox = originPoint?.x ?? SCREEN_W / 2;
  const oy = originPoint?.y ?? SCREEN_H / 2;
  const ringLeft = ox - RING_SIZE / 2;
  const ringTop = oy - RING_SIZE / 2;

  const cardTransform = morphFrom
    ? [
        { translateX: morph.interpolate({ inputRange: [0, 1], outputRange: [morphFrom.dx, 0] }) },
        { translateY: morph.interpolate({ inputRange: [0, 1], outputRange: [morphFrom.dy, 0] }) },
        { scale: morph.interpolate({ inputRange: [0, 1], outputRange: [morphFrom.s0, 1] }) },
      ]
    : [{ scale: cardScale }];

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => { /* blocked during transition */ }}
    >
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]} pointerEvents="box-only">
        {/* Theme scrim — the app dims into its own surface, never a color flood. */}
        <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]} />

        {/* A hairline accent ring rippling from the tapped card */}
        <Animated.View
          style={[styles.ring, { left: ringLeft, top: ringTop, opacity: ring1Opacity, transform: [{ scale: ring1Scale }] }]}
        />

        {/* The workspace card */}
        <Animated.View
          style={[styles.card, { opacity: cardOpacity, transform: cardTransform }]}
          pointerEvents="none"
          onLayout={onCardLayout}
        >
          <Animated.View style={[styles.iconChip, { opacity: iconOpacity, transform: [{ scale: iconScale }] }]}>
            <ToIcon size={30} color={t.accent} strokeWidth={1.9} />
          </Animated.View>

          <Animated.View style={{ opacity: labelOpacity, transform: [{ translateY: labelTranslate }], alignItems: 'center' }}>
            <Animated.Text style={styles.eyebrow}>SWITCHING WORKSPACE</Animated.Text>
            <Animated.Text style={styles.label} numberOfLines={1}>{label}</Animated.Text>
          </Animated.View>

          {/* The spirit level — bubble settles dead center */}
          <View style={styles.levelWrap}>
            <Animated.View style={[styles.levelTrack, { transform: [{ scaleX: trackScaleX }] }]} />
            <View style={styles.levelNotch} />
            <Animated.View style={[styles.bubble, { transform: [{ translateX: bubbleX }] }]} />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ── Styles (theme-derived — readable in light and dark, no accent floods) ─────

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: t.bg,
  },
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 1.5,
    borderColor: t.accent,
  },
  card: {
    alignItems: 'center',
    gap: Tokens.spacing.md,
    paddingVertical: Tokens.spacing['2xl'],
    paddingHorizontal: Tokens.spacing['3xl'],
    borderRadius: Tokens.radius['2xl'],
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.line,
    ...Tokens.shadow.medium,
    zIndex: 2,
  },
  iconChip: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Tokens.radius.panel,
    backgroundColor: t.accentSoft,
  },
  eyebrow: {
    ...Type.caption2,
    fontWeight: '700',
    letterSpacing: 1.6,
    color: t.textMuted,
    textAlign: 'center',
  },
  label: {
    ...Type.title2,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: t.text,
    textAlign: 'center',
    marginTop: 4,
  },
  levelWrap: {
    width: LEVEL_TRACK_W,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  levelTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.line,
  },
  levelNotch: {
    position: 'absolute',
    width: 2,
    height: 10,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.textMuted,
  },
  bubble: {
    position: 'absolute',
    width: BUBBLE_W,
    height: 10,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.accent,
  },
});
