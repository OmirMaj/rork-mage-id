// components/brain/BrainFab.tsx
//
// The single global entry to the MAGE ID Brain. One floating action button,
// mounted once in app/_layout.tsx, present on every screen. Tapping it opens
// the search-first command surface (SearchContext.openSearch → UniversalSearch),
// which is being grown into the unified Brain surface (search + ask + voice +
// "what needs you now"). This FAB replaces the scattered AI doors — the two
// home cards, the HomeFabStack, and the per-screen AICopilot FABs.
//
// Geometry mirrors the old AICopilot FAB (56pt circle, bottom-right, lifted
// above the tab bar) so it lands where users already reach for it.

import React, { useCallback, useEffect, useRef } from 'react';
import { TouchableOpacity, StyleSheet, Platform, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/contexts/ThemeContext';
import { useSearch } from '@/contexts/SearchContext';
import { Tokens } from '@/constants/designTokens';
import { MageAIMark } from '@/components/icons';
import { useBrainFabPresentation, resetBrainFabScroll } from '@/components/brain/brainFabState';

// Routes where the Brain must NOT appear: tokenized public viewers handed to
// clients/subs (they have no account and must see only what's shared), and the
// pre-auth / onboarding flow.
const HIDDEN_ROOTS: ReadonlySet<string> = new Set([
  'shared-estimate', 'shared-photos', 'shared-schedule', 'shared-plan', 'client-view',
  'prequal-form', 'claim-crew',
  'login', 'signup', 'reset-password', 'onboarding', 'persona-select', 'onboarding-paywall',
]);

export function BrainFab() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { openSearch } = useSearch();
  const segments = useSegments();

  // Scroll-away + per-screen suppression / lift. See brainFabState for why the
  // FAB owns this rather than every screen padding around it (audit defect #5).
  const { hidden, lift } = useBrainFabPresentation();

  // A screen that scrolled the FAB away stays mounted under whatever is pushed
  // on top of it, so its own cleanup never runs. Reset on every route change.
  const routeKey = segments.join('/');
  useEffect(() => { resetBrainFabScroll(); }, [routeKey]);

  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: hidden ? 0 : 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [hidden, anim]);

  const handlePress = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    openSearch();
  }, [openSearch]);

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
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Open MAGE Brain"
        testID="brain-fab"
        style={[styles.fab, { backgroundColor: colors.accent }]}
      >
        <MageAIMark size={26} color="#FFFFFF" accentColor="#FFFFFF" />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Positioning + shadow + the hide/lift animation live on the wrapper; the
  // circle itself stays a plain TouchableOpacity so the press behaviour is
  // unchanged from before the scroll-away work.
  fabWrap: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: Tokens.radius.full,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 40,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: Tokens.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
