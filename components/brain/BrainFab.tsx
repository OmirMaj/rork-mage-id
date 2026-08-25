// components/brain/BrainFab.tsx
//
// The single global entry to the MAGE ID Brain. One floating action button,
// mounted once in app/_layout.tsx, present on every screen. Tapping it opens
// the conversational ask screen (app/ask.tsx) — the front door to the Brain.
// Search still exists but is reached from a search icon inside that screen.
// This FAB replaces the scattered AI doors — the two home cards, the
// HomeFabStack, and the per-screen AICopilot FABs.
//
// Geometry mirrors the old AICopilot FAB (56pt circle, bottom-right, lifted
// above the tab bar) so it lands where users already reach for it.
//
// Look & motion: a warm two-tone gradient (accentHot → accent) under a soft
// ambient glow, with a slow "breathing" pulse so it reads as a live assistant
// rather than a flat button, and a snappy spring on press that matches the
// app's Button physics. All on the native driver (transform/opacity), no new
// dependency — expo-linear-gradient is already used elsewhere.

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Platform, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/contexts/ThemeContext';
import { Tokens } from '@/constants/designTokens';
import { MageAIMark } from '@/components/icons';
import { useBrainFabPresentation, resetBrainFabScroll } from '@/components/brain/brainFabState';

// Routes where the Brain must NOT appear: tokenized public viewers handed to
// clients/subs (they have no account and must see only what's shared), the
// pre-auth / onboarding flow, and the ask screen itself (the FAB opens it, so
// it must not float on top of its own destination).
const HIDDEN_ROOTS: ReadonlySet<string> = new Set([
  'shared-estimate', 'shared-photos', 'shared-schedule', 'shared-plan', 'client-view',
  'prequal-form', 'claim-crew', 'ask',
  'login', 'signup', 'reset-password', 'onboarding', 'persona-select', 'onboarding-paywall',
]);

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function BrainFab() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const segments = useSegments();

  // Scroll-away + per-screen suppression / lift. See brainFabState for why the
  // FAB owns this rather than every screen padding around it (audit defect #5).
  const { hidden, lift } = useBrainFabPresentation();

  // A screen that scrolled the FAB away stays mounted under whatever is pushed
  // on top of it, so its own cleanup never runs. Reset on every route change.
  const routeKey = segments.join('/');
  useEffect(() => { resetBrainFabScroll(); }, [routeKey]);

  // hide/show (opacity + slide + shrink), breathing (idle pulse), press (spring).
  const anim = useRef(new Animated.Value(1)).current;
  const breathe = useRef(new Animated.Value(1)).current;
  const press = useRef(new Animated.Value(1)).current;
  // The button scales by breathe × press together; the wrapper owns hide/show.
  const pulseScale = useMemo(() => Animated.multiply(breathe, press), [breathe, press]);

  useEffect(() => {
    Animated.timing(anim, {
      toValue: hidden ? 0 : 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [hidden, anim]);

  // Slow, subtle breath (≈3.4s round trip, 6% swing) — enough to feel alive,
  // gentle enough to ignore. Runs on the native driver so it never janks.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1.09, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  const onPressIn = useCallback(() => {
    Animated.spring(press, { toValue: 0.9, friction: 5, tension: 300, useNativeDriver: true }).start();
  }, [press]);
  const onPressOut = useCallback(() => {
    Animated.spring(press, { toValue: 1, friction: 5, tension: 300, useNativeDriver: true }).start();
  }, [press]);
  const handlePress = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Open the ask screen directly — the conversational surface is the front
    // door to the Brain now. Search moved to a search icon inside that screen.
    // Pass the innermost route name so Ask can offer screen-aware starters.
    const cleaned = segments.map(s => s.replace(/[()]/g, '')).filter(Boolean);
    const screen = cleaned[cleaned.length - 1];
    router.push(screen ? { pathname: '/ask', params: { screen } } : '/ask');
  }, [router, segments]);

  // Hide on public/tokenized viewers and the pre-auth flow.
  if (HIDDEN_ROOTS.has((segments[0] as string) ?? '')) return null;

  return (
    <Animated.View
      // Never hit-test while it's hidden — otherwise an invisible circle keeps
      // swallowing taps meant for the content it used to be covering.
      pointerEvents={hidden ? 'none' : 'auto'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      style={[
        styles.fabWrap,
        {
          bottom: insets.bottom + 70 + lift + (Platform.OS === 'web' ? 48 : 0),
          shadowColor: colors.accent,
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [96, 0] }) },
            { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }) },
          ],
        },
      ]}
    >
      <AnimatedPressable
        onPress={handlePress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityLabel="Open MAGE Brain"
        testID="brain-fab"
        style={[styles.fab, { transform: [{ scale: pulseScale }] }]}
      >
        <LinearGradient
          // Bright warm orange (top-left) → deep burnt orange (bottom-right): a
          // real, visible gradient with depth, not a near-flat one, so the mark
          // reads as premium rather than a plain disc.
          colors={[colors.accentHot, colors.accentFill]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <MageAIMark size={26} color="#FFFFFF" accentColor="#FFFFFF" />
      </AnimatedPressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Positioning + the softened ambient glow + hide/lift live on the wrapper.
  // The button (gradient circle) breathes and springs inside it.
  fabWrap: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: Tokens.radius.full,
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.55,
    shadowRadius: 22,
    elevation: 12,
    zIndex: 40,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: Tokens.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
