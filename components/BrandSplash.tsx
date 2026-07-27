// BrandSplash — the in-app animated launch screen.
//
// The FIRST thing every user sees. Replaces the old AI-slop crest with the
// app's real brand motif: an ink field, the "MAGE ID" wordmark in the app's
// display face (Fraunces), and a thin amber spirit-level track whose bubble
// slides in off-centre, overshoots, and SETTLES DEAD CENTRE — the exact move
// from components/PersonaSwitchOverlay.tsx and the marketing site.
// Construction for "everything is level, you're ready to build."
//
// Ink + amber only. No illustration, crest, gradient, glow, blur, or emoji.
// Colours/type come strictly from constants/colors + typography + tokens.
//
// How it's wired (see app/_layout.tsx):
//   - The NATIVE splash (app.json splash-icon.png, the flat level line) holds
//     the pre-JS moment. SplashScreen.preventAutoHideAsync() keeps it up.
//   - Once fonts load, _layout hides the native splash and mounts THIS
//     component as a full-screen overlay ABOVE the app. The app tree renders
//     and hydrates underneath — so interactivity is never delayed beyond the
//     animation; when we fade out, the app is already there.
//   - Plays once per cold start. onDone() unmounts it.
//
// Timeline (~900ms of motion, mirroring PersonaSwitchOverlay's spring):
//   0ms        — ink field + wordmark/eyebrow already painted (no flash)
//   0–260ms    — eyebrow + wordmark settle up
//   180ms      — level track draws in
//   300ms      — bubble springs from off-centre → overshoot → dead centre
//   ~700ms     — soft settle bloom as it finds centre
//   820ms      — overlay fades out; onDone() at ~1040ms
//
// Reduced motion (AccessibilityInfo) → paint the settled state, brief hold,
// immediate reveal. Web-safe: haptics + native-driver spring guarded.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// ── Brand tokens ────────────────────────────────────────────────────────────
// The splash is a fixed BRAND moment — always the ink field regardless of the
// user's light/dark preference. A splash that flashed cream-white in light
// mode would be jarring and wouldn't match the ink native layer it hands off
// from. These match constants/colors.ts Theme.dark + the marketing --ink.
const INK = '#0B0D10';
const CREAM = '#F4EFE6';
const FOG = 'rgba(244,239,230,0.62)';
const AMBER = '#FF6A1A';
const AMBER_SOFT = 'rgba(255,106,26,0.16)';
const LINE = 'rgba(255,255,255,0.10)';
const NOTCH = 'rgba(244,239,230,0.32)';

// ── Level geometry (from PersonaSwitchOverlay) ───────────────────────────────
const LEVEL_TRACK_W = 200;
const BUBBLE_W = 34;
const BUBBLE_START_X = -62; // off-centre; settles at 0

// ── Timings (ms) — mirror PersonaSwitchOverlay ───────────────────────────────
const T_LABEL = 40;
const T_TRACK = 180;
const T_BUBBLE = 300;
const T_FADE = 820;
const DUR_FADEOUT = 220;

export interface BrandSplashProps {
  /** Called when the splash finishes and the app should be revealed. */
  onDone: () => void;
}

export default function BrandSplash({ onDone }: BrandSplashProps) {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }, [onDone]);

  // Animated values
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const labelOpacity = useRef(new Animated.Value(0)).current;
  const labelTranslate = useRef(new Animated.Value(10)).current;
  const trackScaleX = useRef(new Animated.Value(0)).current;
  const bubbleX = useRef(new Animated.Value(BUBBLE_START_X)).current;
  const settleGlow = useRef(new Animated.Value(0)).current;

  // Resolve reduced-motion once (and keep in sync while mounted), same pattern
  // as onboarding.tsx / PersonaSwitchOverlay.
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => { if (active) setReduceMotion(v); })
      .catch(() => { if (active) setReduceMotion(false); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; sub.remove(); };
  }, []);

  useEffect(() => {
    // Wait until we know the reduced-motion preference before choosing a path.
    if (reduceMotion === null) return;

    if (reduceMotion) {
      // Reduced motion: paint the settled state, brief hold, quick reveal.
      labelOpacity.setValue(1);
      labelTranslate.setValue(0);
      trackScaleX.setValue(1);
      bubbleX.setValue(0);
      const anim = Animated.sequence([
        Animated.delay(500),
        Animated.timing(overlayOpacity, {
          toValue: 0, duration: 260, easing: Easing.out(Easing.ease), useNativeDriver: true,
        }),
      ]);
      anim.start(({ finished }) => { if (finished) finish(); });
      return () => anim.stop();
    }

    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    // Spring physics only on native; web falls back to a timing so we never
    // pass a native-driver spring to the web driver.
    const springy = Platform.OS !== 'web';

    const anim = Animated.parallel([
      // Eyebrow + wordmark settle up.
      Animated.sequence([
        Animated.delay(T_LABEL),
        Animated.parallel([
          Animated.timing(labelOpacity, {
            toValue: 1, duration: 260, easing: Easing.out(Easing.ease), useNativeDriver: true,
          }),
          Animated.timing(labelTranslate, {
            toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true,
          }),
        ]),
      ]),

      // The level track draws in.
      Animated.sequence([
        Animated.delay(T_TRACK),
        Animated.timing(trackScaleX, {
          toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
      ]),

      // The bubble slides from off-centre, overshoots, and settles DEAD CENTRE
      // — same spring constants as PersonaSwitchOverlay's settle.
      Animated.sequence([
        Animated.delay(T_BUBBLE),
        springy
          ? Animated.spring(bubbleX, {
              toValue: 0, damping: 12, stiffness: 150, mass: 0.9, useNativeDriver: true,
            })
          : Animated.timing(bubbleX, {
              toValue: 0, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true,
            }),
      ]),

      // A soft bloom as the bubble finds centre.
      Animated.sequence([
        Animated.delay(T_BUBBLE + 260),
        Animated.timing(settleGlow, {
          toValue: 1, duration: 170, easing: Easing.out(Easing.ease), useNativeDriver: true,
        }),
        Animated.timing(settleGlow, {
          toValue: 0, duration: 280, easing: Easing.in(Easing.ease), useNativeDriver: true,
        }),
      ]),

      // Fade out and hand the screen to the app.
      Animated.sequence([
        Animated.delay(T_FADE),
        Animated.timing(overlayOpacity, {
          toValue: 0, duration: DUR_FADEOUT, easing: Easing.in(Easing.ease), useNativeDriver: true,
        }),
      ]),
    ]);

    anim.start(({ finished }) => {
      if (!finished) return;
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      finish();
    });

    return () => anim.stop();
  }, [reduceMotion, overlayOpacity, labelOpacity, labelTranslate, trackScaleX, bubbleX, settleGlow, finish]);

  // Don't paint until we know the motion preference (one frame) so we never
  // start the motion path and then swap to the reduced path mid-animation.
  if (reduceMotion === null) {
    return <View style={styles.overlay} pointerEvents="none" />;
  }

  return (
    <Animated.View
      style={[styles.overlay, { opacity: overlayOpacity }]}
      pointerEvents="none"
      testID="brand-splash"
    >
      <Animated.View
        style={[styles.center, { opacity: labelOpacity, transform: [{ translateY: labelTranslate }] }]}
      >
        <Text style={styles.eyebrow}>
          <Text style={styles.eyebrowDot}>●</Text>  THE OPERATING SYSTEM FOR BUILDERS
        </Text>
        <Text style={styles.wordmark} numberOfLines={1}>MAGE&nbsp;ID</Text>

        {/* The spirit level — bubble settles dead centre. */}
        <View style={styles.levelWrap}>
          <Animated.View style={[styles.levelTrack, { transform: [{ scaleX: trackScaleX }] }]} />
          <View style={[styles.levelNotch, styles.notchLeft]} />
          <View style={[styles.levelNotch, styles.notchRight]} />
          <View style={styles.levelNotchCenter} />
          <Animated.View style={[styles.bubbleGlow, { opacity: settleGlow }]} />
          <Animated.View style={[styles.bubble, { transform: [{ translateX: bubbleX }] }]} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  center: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  eyebrow: {
    ...Type.monoEyebrow,
    color: FOG,
    textAlign: 'center',
    marginBottom: 18,
  },
  eyebrowDot: {
    color: AMBER,
  },
  wordmark: {
    // Fraunces 700 Bold — the app's display face (loaded in _layout.tsx).
    // Falls back to the platform serif if the font network-blips on first
    // launch; the wordmark still reads.
    fontFamily: 'Fraunces_700Bold',
    fontSize: 44,
    lineHeight: 50,
    letterSpacing: 2,
    color: CREAM,
    textAlign: 'center',
    marginBottom: 28,
  },
  levelWrap: {
    width: LEVEL_TRACK_W,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    borderRadius: Tokens.radius.full,
    backgroundColor: AMBER_SOFT,
  },
  levelNotch: {
    position: 'absolute',
    width: 3,
    height: 12,
    borderRadius: Tokens.radius.full,
    backgroundColor: NOTCH,
  },
  notchLeft: { left: 0 },
  notchRight: { right: 0 },
  levelNotchCenter: {
    position: 'absolute',
    width: 2,
    height: 8,
    borderRadius: Tokens.radius.full,
    backgroundColor: LINE,
  },
  bubble: {
    position: 'absolute',
    width: BUBBLE_W,
    height: 11,
    borderRadius: Tokens.radius.full,
    backgroundColor: AMBER,
  },
  bubbleGlow: {
    position: 'absolute',
    width: BUBBLE_W + 20,
    height: 24,
    borderRadius: Tokens.radius.full,
    backgroundColor: AMBER_SOFT,
  },
});
