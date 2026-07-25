// PersonaSwitchOverlay — "the level finds center" persona-switch transition.
//
// The old version scaled a brand-orange disc over the whole screen — a
// full-bleed accent flood with unreadable text. This one stays inside the
// app's own theme: the screen dims to the theme scrim, two hairline accent
// rings ripple out from the tapped card, and a surface card springs in with
// the destination icon, a readable label, and the signature move — a spirit
// level whose bubble slides in and SETTLES DEAD CENTER. Construction for
// "you've leveled into your new workspace."
//
// Timeline (~1.15s total):
//   0ms       — haptic impact, scrim fades in, ring 1 starts
//   140ms     — ring 2 echoes
//   90–420ms  — card + icon spring in, eyebrow/label rise
//   300–520ms — level track draws in
//   420–850ms — bubble springs to center (the settle)
//   930ms     — overlay fades out; onDone() at ~1150ms
//
// Reduced motion / web: a clean theme-dark crossfade, no theatrics.
// Props are unchanged from the previous version — persona-select needs no edits.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { HardHat, Home, Repeat, Building2 } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
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

// Icons mirroring ROLE_ICONS in persona-select.tsx
const ROLE_ICONS: Record<UserRole, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  contractor:       HardHat,
  client:           Home,
  both:             Repeat,
  property_manager: Building2,
};

// ── Props (unchanged API) ─────────────────────────────────────────────────────

export interface PersonaSwitchOverlayProps {
  /** Show and drive the animation. */
  visible: boolean;
  /** Destination persona. */
  toRole: UserRole;
  /** Pixel position of tapped card center for the ring origin. */
  originPoint?: { x: number; y: number };
  /** Whether reduced motion is active (from AccessibilityInfo). */
  reduceMotion?: boolean;
  /** Called when animation finishes — parent should navigate or finish. */
  onDone: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PersonaSwitchOverlay({
  visible,
  toRole,
  originPoint,
  reduceMotion = false,
  onDone,
}: PersonaSwitchOverlayProps) {
  const { colors: t } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Animated values
  const scrimOpacity   = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const ring1Scale     = useRef(new Animated.Value(0.2)).current;
  const ring1Opacity   = useRef(new Animated.Value(0)).current;
  const ring2Scale     = useRef(new Animated.Value(0.2)).current;
  const ring2Opacity   = useRef(new Animated.Value(0)).current;
  const cardOpacity    = useRef(new Animated.Value(0)).current;
  const cardScale      = useRef(new Animated.Value(0.92)).current;
  const iconScale      = useRef(new Animated.Value(0.7)).current;
  const iconOpacity    = useRef(new Animated.Value(0)).current;
  const labelOpacity   = useRef(new Animated.Value(0)).current;
  const labelTranslate = useRef(new Animated.Value(8)).current;
  const trackScaleX    = useRef(new Animated.Value(0)).current;
  const bubbleX        = useRef(new Animated.Value(BUBBLE_START_X)).current;
  const settleGlow     = useRef(new Animated.Value(0)).current;

  const resetAnimations = useCallback(() => {
    scrimOpacity.setValue(0);
    overlayOpacity.setValue(1);
    ring1Scale.setValue(0.2);
    ring1Opacity.setValue(0);
    ring2Scale.setValue(0.2);
    ring2Opacity.setValue(0);
    cardOpacity.setValue(0);
    cardScale.setValue(0.92);
    iconScale.setValue(0.7);
    iconOpacity.setValue(0);
    labelOpacity.setValue(0);
    labelTranslate.setValue(8);
    trackScaleX.setValue(0);
    bubbleX.setValue(BUBBLE_START_X);
    settleGlow.setValue(0);
  }, [scrimOpacity, overlayOpacity, ring1Scale, ring1Opacity, ring2Scale, ring2Opacity, cardOpacity, cardScale, iconScale, iconOpacity, labelOpacity, labelTranslate, trackScaleX, bubbleX, settleGlow]);

  useEffect(() => {
    if (visible) {
      resetAnimations();
      setMounted(true);
    }
  }, [visible, resetAnimations]);

  useEffect(() => {
    if (!mounted) return;

    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    if (reduceMotion) {
      // Reduced motion: theme-dark crossfade only.
      scrimOpacity.setValue(1);
      cardOpacity.setValue(1);
      cardScale.setValue(1);
      iconOpacity.setValue(1);
      iconScale.setValue(1);
      labelOpacity.setValue(1);
      labelTranslate.setValue(0);
      trackScaleX.setValue(1);
      bubbleX.setValue(0);
      Animated.sequence([
        Animated.delay(420),
        Animated.timing(overlayOpacity, { toValue: 0, duration: 280, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start(() => {
        setMounted(false);
        onDone();
      });
      return;
    }

    const springy = Platform.OS !== 'web';

    Animated.parallel([
      // Scrim settles in fast — the app dims into its own theme, no color flood.
      Animated.timing(scrimOpacity, { toValue: 1, duration: 150, easing: Easing.out(Easing.ease), useNativeDriver: true }),

      // Two hairline rings ripple out from the tapped card.
      Animated.parallel([
        Animated.timing(ring1Scale, { toValue: RING_COVER_SCALE, duration: 760, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(ring1Opacity, { toValue: 0.55, duration: 90, useNativeDriver: true }),
          Animated.timing(ring1Opacity, { toValue: 0, duration: 640, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        ]),
      ]),
      Animated.sequence([
        Animated.delay(140),
        Animated.parallel([
          Animated.timing(ring2Scale, { toValue: RING_COVER_SCALE, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(ring2Opacity, { toValue: 0.35, duration: 90, useNativeDriver: true }),
            Animated.timing(ring2Opacity, { toValue: 0, duration: 680, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          ]),
        ]),
      ]),

      // Card pops in.
      Animated.sequence([
        Animated.delay(T_CARD),
        Animated.parallel([
          Animated.timing(cardOpacity, { toValue: 1, duration: 170, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          springy
            ? Animated.spring(cardScale, { toValue: 1, damping: 16, stiffness: 240, mass: 0.7, useNativeDriver: true })
            : Animated.timing(cardScale, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
      ]),

      // Icon springs in just behind the card.
      Animated.sequence([
        Animated.delay(T_CARD + 70),
        Animated.parallel([
          Animated.timing(iconOpacity, { toValue: 1, duration: 180, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          springy
            ? Animated.spring(iconScale, { toValue: 1, damping: 13, stiffness: 220, mass: 0.8, useNativeDriver: true })
            : Animated.timing(iconScale, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
      ]),

      // Eyebrow + label rise in.
      Animated.sequence([
        Animated.delay(T_CARD + 130),
        Animated.parallel([
          Animated.timing(labelOpacity, { toValue: 1, duration: 200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(labelTranslate, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
      ]),

      // The level draws, then the bubble settles dead center.
      Animated.sequence([
        Animated.delay(T_LEVEL),
        Animated.timing(trackScaleX, { toValue: 1, duration: 210, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.delay(T_BUBBLE),
        springy
          ? Animated.spring(bubbleX, { toValue: 0, damping: 12, stiffness: 150, mass: 0.9, useNativeDriver: true })
          : Animated.timing(bubbleX, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      // A soft glow blooms as the bubble finds center.
      Animated.sequence([
        Animated.delay(T_BUBBLE + 260),
        Animated.timing(settleGlow, { toValue: 1, duration: 160, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(settleGlow, { toValue: 0, duration: 260, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),

      // Fade out and hand back to the app.
      Animated.sequence([
        Animated.delay(T_FADE),
        Animated.timing(overlayOpacity, { toValue: 0, duration: DUR_FADEOUT, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),
    ]).start(() => {
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setMounted(false);
      onDone();
    });
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

        {/* Hairline accent rings rippling from the tapped card */}
        <Animated.View
          style={[styles.ring, { left: ringLeft, top: ringTop, opacity: ring1Opacity, transform: [{ scale: ring1Scale }] }]}
        />
        <Animated.View
          style={[styles.ring, styles.ringThin, { left: ringLeft, top: ringTop, opacity: ring2Opacity, transform: [{ scale: ring2Scale }] }]}
        />

        {/* The workspace card */}
        <Animated.View style={[styles.card, { opacity: cardOpacity, transform: [{ scale: cardScale }] }]} pointerEvents="none">
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
            <Animated.View style={[styles.bubbleGlow, { opacity: settleGlow }]} />
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
  ringThin: {
    borderWidth: 1,
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
  bubbleGlow: {
    position: 'absolute',
    width: BUBBLE_W + 18,
    height: 22,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.accentSoft,
  },
});
