// themeFallback.ts — the palette a loader uses when it renders OUTSIDE the
// ThemeProvider.
//
// BrandSplash mounts after </ThemeProvider></ThemeLoader> in app/_layout.tsx,
// and useTheme() (createContextHook, no default value) returns undefined
// there. So every component in components/loaders/* reads the theme as
//
//     const theme = useTheme();                                // may be undefined
//     const colors = theme?.colors ?? splashFallbackColors();
//
// never `const { colors } = useTheme()` (a TypeError on every cold start).
// The fallback is the dark palette (the splash ink) with the user's hue.
// scripts/validate-level.ts rule D enforces the pattern.

import { Theme, deriveAccentPalette, getCustomPrimary, type ThemeColors } from '@/constants/colors';
import { NATIVE_SPLASH_ACCENT, NATIVE_SPLASH_CAP } from '@/utils/levelTimeline';

let cached: { hue: string; colors: ThemeColors } | null = null;

/** Memoised on the current custom hue. */
export function splashFallbackColors(): ThemeColors {
  const hue = getCustomPrimary();
  if (!cached || cached.hue !== hue) {
    cached = { hue, colors: { ...Theme.dark, ...deriveAccentPalette(hue, 'dark') } };
  }
  return cached.colors;
}

export type LevelTone = 'accent' | 'onAccent' | 'muted' | 'splash';

export interface LevelPalette { bubble: string; track: string; cap: string; grad: string; beat: string; lvl: string }

/**
 * The colours a level draws, by tone. Tokens only — except the splash tone,
 * which reads NO token at all (NATIVE_SPLASH_* must equal the baked PNG).
 *   accent:   bubble accent; track accent (at the geometry's opacity); caps +
 *             graduations textMuted; the beat + lvl overlays accent.
 *   onAccent: bubble, caps and track all in `color` (the button label colour).
 *   muted:    bubble + track + caps textMuted.
 */
export function levelPalette(tone: LevelTone, color: string | undefined, colors: ThemeColors | null): LevelPalette {
  if (tone === 'splash' || !colors) {
    const bubble = color ?? NATIVE_SPLASH_ACCENT;
    return { bubble, track: NATIVE_SPLASH_ACCENT, cap: NATIVE_SPLASH_CAP, grad: NATIVE_SPLASH_CAP, beat: NATIVE_SPLASH_ACCENT, lvl: NATIVE_SPLASH_ACCENT };
  }
  if (tone === 'onAccent') {
    const c = color ?? colors.bg;
    return { bubble: c, track: c, cap: c, grad: c, beat: c, lvl: c };
  }
  if (tone === 'muted') {
    return { bubble: color ?? colors.textMuted, track: colors.textMuted, cap: colors.textMuted, grad: colors.textMuted, beat: colors.accent, lvl: colors.accent };
  }
  return { bubble: color ?? colors.accent, track: colors.accent, cap: colors.textMuted, grad: colors.textMuted, beat: colors.accent, lvl: colors.accent };
}
