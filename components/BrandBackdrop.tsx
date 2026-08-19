// components/BrandBackdrop.tsx
//
// Shared ink-field + accent-corner-glow backdrop for onboarding and
// persona-select. Both screens used an identical 3-layer LinearGradient
// recipe — extracted here so the two can't drift.
//
// Doctrine: accent (#FF6A1A) is an ACCENT, not a background. The large
// field is ink (#0B0D10 → #14181D). The corner-glow layers carry the
// brand warmth without flooding the frame in orange.

import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// Local brand palette — kept hardcoded so the splash looks identical
// regardless of any custom-primary the user has set in Settings.
const INK_DEEP = '#0B0D10';
const INK_MID  = '#14181D';
const ORANGE_HOT = '#FF8533';
const ORANGE     = '#FF6A1A';

/**
 * Foregrounds that are legible ON the ink field this component paints.
 *
 * These are deliberately NOT ThemeColors. The backdrop is the same opaque ink
 * (#0B0D10 → #14181D) in light AND dark mode, so a hero drawn on it must be
 * light-on-ink in both — swapping these for `t.text` / `t.textSecondary` puts
 * near-black type (#2B3038) on the ink field at 1.34:1 in the light theme.
 *
 * They live here, next to the field they are contrast-matched against, so the
 * coupling is explicit: a screen that imports `OnInk` must also render
 * `<BrandBackdrop />`, and `scripts/validate-contrast.ts` asserts exactly that.
 * `onboarding.tsx` and `persona-select.tsx` already keep private `cream`/`ink`
 * constants for the same reason; this is that idea, shared.
 *
 * Measured against INK_MID: title 15.56:1, subtitle 10.17:1, eyebrow 7.35:1.
 */
export const OnInk = {
  /** Display/screen title on the ink field. */
  title: '#F4EFE6',
  /** Secondary line under the title. */
  subtitle: '#C9C3B8',
  /** Uppercase micro-label above the title. */
  eyebrow: ORANGE_HOT,
} as const;

/**
 * Three-layer ink+amber backdrop.
 *
 * Layer 1 — base gradient: deep ink at edges, mid-ink in the center.
 *            This is the large field; it is NOT orange.
 * Layer 2 — top-right corner glow: faint orange (22% opacity) fading
 *            to transparent. Gives brand warmth without flooding.
 * Layer 3 — bottom-left corner wash: very faint orange (8% opacity).
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
        colors={[ORANGE_HOT + '38', 'transparent']}
        start={{ x: 0.85, y: 0 }}
        end={{ x: 0.2, y: 0.6 }}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Bottom-left echo */}
      <LinearGradient
        colors={['transparent', ORANGE + '14']}
        start={{ x: 0.1, y: 0.7 }}
        end={{ x: 0.6, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
    </>
  );
}
