// components/desktop/DesktopPageFrame.tsx — the page column for every root
// Stack route on desktop web.
//
// WHY (wave 6b). Stack routes rendered in a bare flex:1 View beside the
// sidebar, so most of them drew 1816 px wide on a 2056 px window: 1000–1470 px
// inputs, 1360 px buttons, a phone column stretched across a monitor. Instead
// of 125 per-screen caps, app/_layout.tsx hands this frame to the root Stack's
// `screenLayout`, and utils/desktopPage.ts says how wide each route's column
// is (Layout.page[kind] — one width source).
//
// PHONE IDENTICAL. On native the frame returns its children with no host View
// at all, so the iPhone tree is exactly what shipped before. On web the frame
// renders the same two Views at every width — crossing the 900 px breakpoint
// only changes their style, it never remounts the screen underneath — and
// below desktop both are plain flex:1. Routes that are not framed (the tab
// navigator, bleed tools, self-capped screens) pass straight through on every
// platform: their route never changes kind, so that is stable too.
//
// Trade-off, accepted by the audit: the mouse wheel does nothing over the
// blank margins of a framed page (the ScrollView sits inside the column), the
// same as the tab routes have always had. The most-used screens stay
// self-capped for that reason (utils/desktopPage.ts SELF_CAPPED_ROUTES).

import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Layout } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { frameKindForRoute } from '@/utils/desktopPage';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';

export interface DesktopPageFrameProps {
  /** The root Stack route name (e.g. 'rfi', 'integrations/qbo/callback'). */
  route: string;
  children: React.ReactNode;
}

export function DesktopPageFrame({ route, children }: DesktopPageFrameProps): React.ReactElement {
  const kind = frameKindForRoute(route);
  if (Platform.OS !== 'web' || kind === null) return <>{children}</>;
  return <WebFrame maxWidth={Layout.page[kind]}>{children}</WebFrame>;
}

/** Split out so the hooks run only on web framed routes — a pass-through
 *  route (and every native render) calls no hook at all. */
function WebFrame({ maxWidth, children }: { maxWidth: number; children: React.ReactNode }) {
  const { isDesktop } = useResponsiveLayout();
  const { colors: t } = useTheme();
  return (
    <View
      style={[styles.fill, isDesktop && styles.outerDesktop, isDesktop && { backgroundColor: t.bg }]}
      testID="desktop-page-frame"
    >
      <View style={[styles.fill, isDesktop && styles.innerDesktop, isDesktop && { maxWidth }]}>
        {children}
      </View>
    </View>
  );
}

/**
 * Module-level render function for `<Stack screenLayout>`. Stable identity, so
 * the navigator never sees a new layout prop and re-renders every descriptor.
 */
export function renderDesktopPageFrame({ route, children }: { route: { name: string }; children: React.ReactElement }) {
  return <DesktopPageFrame route={route.name}>{children}</DesktopPageFrame>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Layout only — colour is applied from the live theme above.
  outerDesktop: { alignItems: 'center' },
  innerDesktop: { width: '100%' },
});

export default DesktopPageFrame;
