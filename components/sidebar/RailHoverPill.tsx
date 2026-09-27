// components/sidebar/RailHoverPill.tsx — the collapsed rail's instant hover
// label (wave 6d, d6r lane K3), and the rail's palette.
//
// The 64 px icon rail used a native `title` tooltip, which the browser shows
// after about a second and styles however it likes. This pill appears the
// moment the pointer (or keyboard focus) reaches a square, beside it, at
// x = rail left + Layout.sidebar.rail + Layout.menu.offset (68 at the window
// edge), vertically centred on the square, and reads the row's label with its
// live count ('RFIs · 4 open, 1 overdue').
//
// WHY A PORTAL (fix round 1). react-native-web gives every View
// `position: relative; z-index: 0`, so every View is its own stacking context.
// app/_layout.tsx renders the sidebar's wrapper View BEFORE the page's View,
// both at z-index 0, so the page paints over anything inside the sidebar —
// and the pill starts at x 68, past the 64 px rail, entirely over the page. A
// zIndex inside the sidebar only orders it among the sidebar's own children.
// So on web the pill is portalled into document.body with position: fixed and
// viewport coordinates: a sibling of the app root, whose own z-index-0 context
// its zIndex clears. The React tree position (DesktopSidebar's collapsed
// container, last child) is unchanged.
//
// pointerEvents none (in the style — RN-web 0.21 deprecates the prop): it never
// eats the click meant for the square under it. Desktop-web only in practice:
// RailTip reports hovers from DOM listeners that only exist on web, so the
// inline (non-portal) path below never draws.

import React from 'react';
import { View, Text, StyleSheet, Platform, type ViewStyle } from 'react-native';
import { Layout, Shadow, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { webMotion } from '@/components/ui/motion';

/**
 * The rail paints its own dark ground in BOTH themes (self-darkening chrome,
 * scripts/validate-theme-baking.ts), so its inks are white alphas rather than
 * theme tokens. The one themed fill is the active row (colors.accentFill).
 * One palette for the rail (DesktopSidebar), its hover pill (below) and the
 * Action Required row — they must paint the same ground.
 */
export const RAIL = {
  ground: '#1C1C1E',
  ink: '#FFFFFF',
  label: 'rgba(255,255,255,0.6)',
  dim: 'rgba(255,255,255,0.45)',
  muted: 'rgba(255,255,255,0.3)',
  hover: 'rgba(255,255,255,0.06)',
  rule: 'rgba(255,255,255,0.06)',
} as const;

/** The pill's height; `top` is its top edge, so a caller centres it on a
 *  square with `rect.top + rect.height / 2 - RAIL_PILL_HEIGHT / 2`. */
export const RAIL_PILL_HEIGHT = 28;
/** Left edge, relative to the rail's own left edge: the rail plus the menu gap. */
export const RAIL_PILL_LEFT = Layout.sidebar.rail + Layout.menu.offset;

// react-dom ships no type declarations here (no @types/react-dom), so the one
// function used is typed by hand. Its entry module is ~7 KB and requires only
// 'react' — it touches no DOM until createPortal is called, which happens on
// web alone.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createPortal } = require('react-dom') as {
  createPortal(children: React.ReactNode, container: Element): React.ReactPortal;
};

/** Where the pill is portalled on web: document.body (null off web). */
export function railPillHost(): HTMLElement | null {
  return Platform.OS === 'web' && typeof document !== 'undefined' ? document.body : null;
}

interface RailHoverPillProps {
  label: string;
  /** Top edge in viewport px (the hovered square's getBoundingClientRect). */
  top: number;
  /** Left edge in viewport px: the rail's left + RAIL_PILL_LEFT. */
  left: number;
}

export function RailHoverPill({ label, top, left }: RailHoverPillProps) {
  // Fades in on web; null under Reduce Motion (and on native), so it simply
  // appears.
  const fade = webMotion('fadeIn');
  const host = railPillHost();
  const pill = (
    <View
      style={[styles.railPill, host ? styles.railPillFixed : null, { top, left, pointerEvents: 'none' }, ...(fade ? [fade] : [])]}
      testID="sidebar-rail-pill"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={styles.railPillLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
  return host ? createPortal(pill, host) : pill;
}

const styles = StyleSheet.create({
  railPill: {
    position: 'absolute' as const,
    height: RAIL_PILL_HEIGHT,
    paddingHorizontal: 10,
    justifyContent: 'center' as const,
    borderRadius: Tokens.radius.sm,
    backgroundColor: RAIL.ground,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    zIndex: 50,
    ...Shadow.medium,
  },
  // Web only: fixed to the viewport, above the app root's stacking context.
  // RN's ViewStyle has no 'fixed'; react-native-web passes it through.
  railPillFixed: {
    position: 'fixed' as unknown as ViewStyle['position'],
    zIndex: 1000,
  },
  railPillLabel: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: RAIL.ink,
  },
});
