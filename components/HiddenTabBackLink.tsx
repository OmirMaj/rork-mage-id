// components/HiddenTabBackLink.tsx
//
// The way out of a tab that has no tab button.
//
// NAV-07 (runtime audit 2026-09-06). Five routes are registered in
// app/(tabs)/_layout.tsx with `href: null` — subs, equipment, materials,
// estimate and mage-id-bids. They are real tabs with no entry in the bar, so
// arriving at one from Discover is a TAB SWITCH, not a stack push: React
// Navigation creates no back button, and none of the four visible tabs lights
// up. The screens drew nothing of their own either, so a GC who went
// Discover → Tools → Subs, checked a sub, and wanted to go back had to tap
// Discover (which resets to Overview), tap Tools, and scroll to where he was.
//
// WHY THIS IS A PUSH TO A NAMED DESTINATION AND NOT `router.back()`.
// It is tempting to reuse hooks/useSafeBack (canGoBack ? back : home). Don't.
// On a tab switch the TabRouter's own history IS non-empty, so `canGoBack()`
// answers true — and its GO_BACK under the default `backBehavior: 'firstRoute'`
// returns you to the FIRST tab, not to the screen you came from. A chevron that
// lands somewhere other than where it points is the small lie this control
// exists to remove. So every instance names its destination in visible text and
// pushes exactly that. If the label and the route ever disagree, the label is
// the bug.
//
// The destination is the surface that actually links to the screen:
//   subs, equipment                 → Discover ▸ Tools (app/(tabs)/discover/tools.tsx)
//   materials, estimate             → Discover        (its sub-tab strip)
//   mage-id-bids                    → Discover        (the marketplace card)
//
// Hidden on desktop: DesktopSidebar is the primary nav there and every one of
// these screens is one click away in it, so a back link would be clutter
// pointing at a place the user can already see.

import React, { useCallback } from 'react';
import { Text, TouchableOpacity, StyleSheet, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';

interface Props {
  /** Visible text. MUST name where `href` actually goes. */
  label: string;
  /** The route pushed on press. */
  href: string;
  /** Foreground. Defaults to the brand primary; pass OnInk.title on an ink hero. */
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function HiddenTabBackLink({ label, href, color, style, testID }: Props) {
  const router = useRouter();
  const { isDesktop } = useResponsiveLayout();

  const onPress = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    router.push(href as never);
  }, [router, href]);

  if (isDesktop) return null;

  const tint = color ?? Colors.primary;

  return (
    <TouchableOpacity
      style={[styles.link, style]}
      onPress={onPress}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      // Spoken as "Back to Tools", which is what the two visible glyphs mean.
      accessibilityLabel={`Back to ${label}`}
      testID={testID}
    >
      <ChevronLeft size={15} color={tint} strokeWidth={2} />
      <Text style={[styles.label, { color: tint }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  label: { fontSize: Type.footnote.fontSize, fontWeight: '600' },
});

export default HiddenTabBackLink;
