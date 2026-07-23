// PersonaSwitchOverlay — full-screen persona-switch animation.
//
// Plays a circular reveal expanding from the tapped role card's position,
// with a centered icon morph/crossfade and a label fade-in, then fades
// out revealing the app in the new persona.
//
// Timeline (~1.2s total):
//   0ms      — haptic impact + circle starts expanding
//   0–600ms  — circle expands from card position to cover screen
//   250ms    — icon crossfade begins (from-icon fades out, to-icon fades in)
//   400ms    — label fades in
//   750ms    — role committed (setUserRole called), overlay begins fade-out
//   900ms    — overlay fully transparent; onDone() fires
//
// Props:
//   visible     — mounts/drives the animation
//   toRole      — destination persona
//   originPoint — { x, y } pixel position of the tapped card's center
//                 (measured via measureInWindow). Falls back to screen center.
//   onDone      — called when animation completes; parent can navigate/commit

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
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { UserRole } from '@/utils/onboardingProfile';
import { USER_ROLE_LABELS } from '@/utils/onboardingProfile';

// ── Constants ─────────────────────────────────────────────────────────────────

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
// The circle must cover the full screen diagonal from any corner.
const SCREEN_DIAGONAL = Math.ceil(Math.sqrt(SCREEN_W * SCREEN_W + SCREEN_H * SCREEN_H));
// Final circle diameter: large enough to cover from any origin point.
const CIRCLE_MAX = SCREEN_DIAGONAL * 2 + 40;

// Duration constants (ms)
const DUR_CIRCLE    = 600;   // circle expand
const DUR_ICON_FADE = 200;   // each icon crossfade leg
const T_ICON_START  = 250;   // when icon crossfade begins
const T_LABEL_START = 400;   // when label fades in
const T_COMMIT      = 750;   // when role is committed + fade-out begins
const DUR_FADEOUT   = 220;   // overlay opacity fade out

// Per-role accent color token pair: [circleColor, iconColor]
// Using only Colors tokens — no raw hex.
// For accentLight (yellow) and warning (orange) circles, primaryDark gives
// readable contrast without needing a separate ink token.
const ROLE_COLORS: Record<UserRole, { circle: string; icon: string }> = {
  contractor:      { circle: Colors.primary,      icon: Colors.textOnPrimary },
  client:          { circle: Colors.accentLight,  icon: Colors.primaryDark   },
  both:            { circle: Colors.primary,      icon: Colors.textOnPrimary },
  property_manager:{ circle: Colors.warning,      icon: Colors.textOnPrimary },
};

// Icons mirroring ROLE_ICONS in persona-select.tsx
const ROLE_ICONS: Record<UserRole, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  contractor:       HardHat,
  client:           Home,
  both:             Repeat,
  property_manager: Building2,
};

// ── Props ──────────────────────────────────────────────────────────────────────

export interface PersonaSwitchOverlayProps {
  /** Show and drive the animation. */
  visible: boolean;
  /** Destination persona. */
  toRole: UserRole;
  /** Pixel position of tapped card center for reveal origin. */
  originPoint?: { x: number; y: number };
  /** Whether reduced motion is active (from AccessibilityInfo). */
  reduceMotion?: boolean;
  /** Called when animation finishes — parent should navigate or finish. */
  onDone: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function PersonaSwitchOverlay({
  visible,
  toRole,
  originPoint,
  reduceMotion = false,
  onDone,
}: PersonaSwitchOverlayProps) {
  const [mounted, setMounted] = useState(false);

  // Animated values
  const circleScale    = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const iconOldOpacity = useRef(new Animated.Value(1)).current;
  const iconNewOpacity = useRef(new Animated.Value(0)).current;
  const iconScale      = useRef(new Animated.Value(0.72)).current;
  const labelOpacity   = useRef(new Animated.Value(0)).current;
  const labelTranslate = useRef(new Animated.Value(8)).current;

  // Track whether we've already fired the commit so we don't double-call
  const committed = useRef(false);

  // Reset all values
  const resetAnimations = useCallback(() => {
    circleScale.setValue(0);
    overlayOpacity.setValue(1);
    iconOldOpacity.setValue(1);
    iconNewOpacity.setValue(0);
    iconScale.setValue(0.72);
    labelOpacity.setValue(0);
    labelTranslate.setValue(8);
    committed.current = false;
  }, [circleScale, overlayOpacity, iconOldOpacity, iconNewOpacity, iconScale, labelOpacity, labelTranslate]);

  useEffect(() => {
    if (visible) {
      resetAnimations();
      setMounted(true);
    }
  }, [visible, resetAnimations]);

  useEffect(() => {
    if (!mounted) return;

    // Fire haptic on native
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    if (reduceMotion || Platform.OS === 'web') {
      // Reduced motion / web: simple crossfade, commit immediately
      overlayOpacity.setValue(1);
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start(() => {
        setMounted(false);
        onDone();
      });
      return;
    }

    // Full animation sequence using Animated.sequence + parallel
    Animated.parallel([
      // Circle expands to cover screen
      Animated.timing(circleScale, {
        toValue: 1,
        duration: DUR_CIRCLE,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      // Icon: old fades out, new fades + scales in
      Animated.sequence([
        Animated.delay(T_ICON_START),
        Animated.parallel([
          Animated.timing(iconOldOpacity, {
            toValue: 0,
            duration: DUR_ICON_FADE,
            useNativeDriver: true,
          }),
          Animated.timing(iconNewOpacity, {
            toValue: 1,
            duration: DUR_ICON_FADE * 1.5,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.spring(iconScale, {
            toValue: 1,
            damping: 14,
            stiffness: 220,
            mass: 0.8,
            useNativeDriver: true,
          }),
        ]),
      ]),
      // Label fades in from slightly below
      Animated.sequence([
        Animated.delay(T_LABEL_START),
        Animated.parallel([
          Animated.timing(labelOpacity, {
            toValue: 1,
            duration: 200,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(labelTranslate, {
            toValue: 0,
            duration: 220,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ]),
      // Commit + fade out after T_COMMIT
      Animated.sequence([
        Animated.delay(T_COMMIT),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: DUR_FADEOUT,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      // Haptic success on native at end
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setMounted(false);
      onDone();
    });
  }, [mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mounted) return null;

  const { circle: circleColor, icon: iconColor } = ROLE_COLORS[toRole];
  const ToIcon = ROLE_ICONS[toRole];
  const label = USER_ROLE_LABELS[toRole];

  // Reveal origin — default to center if not provided
  const ox = originPoint?.x ?? SCREEN_W / 2;
  const oy = originPoint?.y ?? SCREEN_H / 2;

  // Circle's top-left position so that its center aligns with the origin point
  const circleTopLeft = ox - CIRCLE_MAX / 2;
  const circleTop = oy - CIRCLE_MAX / 2;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => { /* blocked during transition */ }}
    >
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]} pointerEvents="box-only">
        {/* Expanding circle */}
        <Animated.View
          style={[
            styles.circle,
            {
              backgroundColor: circleColor,
              width: CIRCLE_MAX,
              height: CIRCLE_MAX,
              borderRadius: CIRCLE_MAX / 2,
              left: circleTopLeft,
              top: circleTop,
              transform: [{ scale: circleScale }],
            },
          ]}
        />

        {/* Centered icon + label */}
        <View style={styles.centerContent} pointerEvents="none">
          {/* Icon container — crossfade between "generic" (from) and toRole icon */}
          <View style={styles.iconWrap}>
            {/* New-role icon: fades in and scales up */}
            <Animated.View
              style={[
                StyleSheet.absoluteFillObject,
                styles.iconInner,
                {
                  opacity: iconNewOpacity,
                  transform: [{ scale: iconScale }],
                },
              ]}
            >
              <ToIcon size={48} color={iconColor} strokeWidth={1.8} />
            </Animated.View>
          </View>

          {/* Label */}
          <Animated.Text
            style={[
              styles.label,
              {
                opacity: labelOpacity,
                transform: [{ translateY: labelTranslate }],
                color: iconColor,
              },
            ]}
            numberOfLines={1}
          >
            Switching to {label}
          </Animated.Text>
        </View>
      </Animated.View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    // Dark fallback behind the circle during the expand phase
    backgroundColor: 'transparent',
  },
  circle: {
    position: 'absolute',
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Tokens.spacing.md,
    zIndex: 2,
  },
  iconWrap: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...Type.headline,
    fontWeight: '700',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
});
