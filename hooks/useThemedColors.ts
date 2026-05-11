// useThemedColors — returns a palette object that reacts to the
// active theme (light/dark). Screens migrated to dark mode call this
// hook instead of importing the static Colors module directly.
//
// Why a hook instead of mutating the global Colors module: the
// existing 149 screens reference Colors.* at module load time —
// mutating Colors would either require a full re-render trigger or
// be skipped by memoization. A per-screen opt-in hook lets us migrate
// surfaces incrementally without risk of breaking unmigrated screens.
//
// Usage pattern in a screen:
//   const c = useThemedColors();
//   <View style={{ backgroundColor: c.surface, color: c.text }}>
//
// When a screen isn't migrated yet, it keeps using `Colors.surface`
// (the light-mode static module) and is unaffected.

import { useMemo } from 'react';
import { Colors } from '@/constants/colors';
import { useResolvedTheme } from '@/contexts/ThemeContext';

export interface ThemedPalette {
  // Surfaces
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceElevated: string;
  card: string;
  cardBorder: string;
  border: string;
  borderLight: string;
  // Text
  text: string;
  textSecondary: string;
  textMuted: string;
  // Brand carry-through (same in both modes)
  primary: string;
  accent: string;
  cream: string;
  ink: string;
  // Semantic
  success: string;
  warning: string;
  error: string;
  info: string;
  // Fills
  fillTertiary: string;
  fillSecondary: string;
  // Overlay
  shadow: string;
  overlay: string;
  // Helpful flag for branching
  isDark: boolean;
}

const LIGHT: Omit<ThemedPalette, 'isDark'> = {
  background: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceAlt: '#F2F2F7',
  surfaceElevated: '#FFFFFF',
  card: '#FFFFFF',
  cardBorder: 'rgba(60,60,67,0.18)',
  border: 'rgba(60,60,67,0.18)',
  borderLight: 'rgba(60,60,67,0.08)',
  text: '#000000',
  textSecondary: 'rgba(60,60,67,0.6)',
  textMuted: 'rgba(60,60,67,0.36)',
  primary: '#1A6B3C',
  accent: '#FF6A1A',
  cream: '#F4EFE6',
  ink: '#0B0D10',
  success: '#34C759',
  warning: '#FF9500',
  error: '#FF3B30',
  info: '#007AFF',
  fillTertiary: 'rgba(120,120,128,0.12)',
  fillSecondary: 'rgba(120,120,128,0.08)',
  shadow: 'rgba(0,0,0,0.05)',
  overlay: 'rgba(0,0,0,0.45)',
};

// Dark palette — derived from the marketing site's `--ink`/`--steel`/
// `--concrete` lineage. Surfaces darken; text inverts to cream/fog;
// brand amber + cream stay the same so the brand still reads. Semantic
// colors stay vivid against dark to keep status pills legible.
const DARK: Omit<ThemedPalette, 'isDark'> = {
  background: '#0B0D10',       // ink — the deepest surface
  surface: '#14181D',          // steel — cards
  surfaceAlt: '#1A1F26',       // a touch lighter than surface for layering
  surfaceElevated: '#1F252D',  // modal sheets / popovers
  card: '#14181D',
  cardBorder: 'rgba(255,255,255,0.08)',
  border: 'rgba(255,255,255,0.12)',
  borderLight: 'rgba(255,255,255,0.06)',
  text: '#F4EFE6',                          // cream — primary text
  textSecondary: 'rgba(244,239,230,0.7)',   // cream @ 70%
  textMuted: 'rgba(244,239,230,0.42)',      // cream @ 42%
  primary: '#22C55E',                       // lighter green for dark contrast
  accent: '#FF6A1A',                        // brand amber unchanged
  cream: '#F4EFE6',
  ink: '#0B0D10',
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#F87171',
  info: '#60A5FA',
  fillTertiary: 'rgba(244,239,230,0.06)',
  fillSecondary: 'rgba(244,239,230,0.10)',
  shadow: 'rgba(0,0,0,0.40)',
  overlay: 'rgba(0,0,0,0.65)',
};

/**
 * Returns the active palette for the current theme mode. Re-renders
 * when the theme changes. Stable identity per render within a mode.
 */
export function useThemedColors(): ThemedPalette {
  const mode = useResolvedTheme();
  return useMemo(
    () => ({
      ...(mode === 'dark' ? DARK : LIGHT),
      isDark: mode === 'dark',
    }),
    [mode],
  );
}

/**
 * One-shot read of the palette outside React (e.g., from a utility).
 * Doesn't react to theme changes — caller is responsible.
 */
export function getThemedColors(mode: 'light' | 'dark'): ThemedPalette {
  return {
    ...(mode === 'dark' ? DARK : LIGHT),
    isDark: mode === 'dark',
  };
}

// Keep a reference to the static Colors so usages that still need it
// for non-themed values (e.g., accent gradients) can co-exist.
export const STATIC_COLORS = Colors;
