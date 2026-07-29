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

import React, { useCallback } from 'react';
import { TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/contexts/ThemeContext';
import { useSearch } from '@/contexts/SearchContext';
import { Tokens } from '@/constants/designTokens';
import { MageAIMark } from '@/components/icons';

// Routes where the Brain must NOT appear: tokenized public viewers handed to
// clients/subs (they have no account and must see only what's shared), and the
// pre-auth / onboarding flow.
const HIDDEN_ROOTS: ReadonlySet<string> = new Set([
  'shared-estimate', 'shared-photos', 'shared-schedule', 'client-view',
  'prequal-form', 'claim-crew',
  'login', 'signup', 'reset-password', 'onboarding', 'persona-select', 'onboarding-paywall',
]);

export function BrainFab() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { openSearch } = useSearch();
  const segments = useSegments();

  const handlePress = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    openSearch();
  }, [openSearch]);

  // Hide on public/tokenized viewers and the pre-auth flow.
  if (HIDDEN_ROOTS.has((segments[0] as string) ?? '')) return null;

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Open MAGE Brain"
      testID="brain-fab"
      style={[
        styles.fab,
        {
          bottom: insets.bottom + 70 + (Platform.OS === 'web' ? 48 : 0),
          backgroundColor: colors.accent,
          shadowColor: colors.accent,
        },
      ]}
    >
      <MageAIMark size={26} color="#FFFFFF" accentColor="#FFFFFF" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: Tokens.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 40,
  },
});
