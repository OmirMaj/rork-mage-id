// components/BrandBackdrop.tsx
//
// Shared ink-field + accent-corner-glow backdrop for onboarding and
// persona-select. Both screens used an identical 3-layer LinearGradient
// recipe — extracted here so the two can't drift.
//
// Doctrine: the brand green is an ACCENT, not a background. The large
// field is the dark ground (#151816 → #1D211F). The corner-glow layers carry
// the brand without flooding the frame in green.

import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND_ACCENT_ON_DARK } from '@/constants/colors';

// Local brand palette — pinned to the MAGE brand constants (not the themed
// accent) so the backdrop looks identical regardless of any custom primary the
// user has set in Settings. The grounds are the rebrand's dark ground/surface
// (Theme.dark.bg / .surface, 2026-09-16) rather than the old blue-black ink, so
// this hero sits on the same page as the dark theme it hands off to.
//
// The glow is BRAND_ACCENT_ON_DARK, not BRAND_ACCENT: #2F6B3A on this ground
// is 2.80:1 and a 22% wash of it is invisible, while #5DB36E reads as the
// brand on dark (6.93:1) and doubles as the eyebrow ink below.
const INK_DEEP = '#151816';
const INK_MID  = '#1D211F';
const GREEN_ON_INK = BRAND_ACCENT_ON_DARK;

/**
 * Foregrounds that are legible ON the ink field this component paints.
 *
 * These are deliberately NOT ThemeColors. The backdrop is the same opaque ink
 * (#151816 → #1D211F) in light AND dark mode, so a hero drawn on it must be
 * light-on-ink in both — swapping these for `t.text` / `t.textSecondary` puts
 * near-black type (#2B3038) on the ink field at 1.34:1 in the light theme.
 *
 * They live here, next to the field they are contrast-matched against, so the
 * coupling is explicit: a screen that imports `OnInk` must also render
 * `<BrandBackdrop />`, and `scripts/validate-contrast.ts` asserts exactly that.
 * `onboarding.tsx` and `persona-select.tsx` already keep private `cream`/`ink`
 * constants for the same reason; this is that idea, shared.
 *
 * Measured against INK_MID (#1D211F): title 14.22:1, subtitle 9.29:1,
 * eyebrow (#5DB36E) 6.31:1.
 */
export const OnInk = {
  /** Display/screen title on the ink field. */
  title: '#F4EFE6',
  /** Secondary line under the title. */
  subtitle: '#C9C3B8',
  /** Uppercase micro-label above the title. */
  eyebrow: GREEN_ON_INK,
} as const;

/**
 * Three-layer ink+green backdrop.
 *
 * Layer 1 — base gradient: deep ink at edges, mid-ink in the center.
 *            This is the large field; it is NOT green.
 * Layer 2 — top-right corner glow: faint brand green (22% opacity)
 *            fading to transparent. Carries the brand without flooding.
 * Layer 3 — bottom-left corner wash: very faint green (8% opacity).
 *            Echoes the glow without competing with content.
 *
 * All three use absoluteFillObject so they stack behind whatever is
 * rendered inside the parent View.
 */
export function BrandBackdrop() {
  return (
    <>
      {/* Base — ink field */}
      <LinearGradient
        colors={[INK_DEEP, INK_MID, INK_MID, INK_DEEP]}
        locations={[0, 0.35, 0.7, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Top-right accent glow */}
      <LinearGradient
        colors={[GREEN_ON_INK + '38', 'transparent']}
        start={{ x: 0.85, y: 0 }}
        end={{ x: 0.2, y: 0.6 }}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Bottom-left echo */}
      <LinearGradient
        colors={['transparent', GREEN_ON_INK + '14']}
        start={{ x: 0.1, y: 0.7 }}
        end={{ x: 0.6, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
    </>
  );
}
