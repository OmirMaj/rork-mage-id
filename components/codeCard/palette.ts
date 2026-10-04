// components/codeCard/palette.ts — the code cards' colours, from the theme
// tokens (light and dark follow ThemeContext), plus the Sunlight variant.
//
// Sunlight is scoped to code cards (utils/codeCard/sunlight.ts) and never
// touches the global theme: white ground, black ink, 2 pt rules, one type step
// up. Every component takes an optional `sunlight` prop that overrides the
// stored preference (tests and previews pin it).
//
// AMBER IS RESERVED. `warn*` is only for a drawing that is wrong (a plan-check
// "fix") and for "close to the line". Model recall is neutral grey.

import { useMemo, useSyncExternalStore } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';
import { getSunlight, subscribeSunlight } from '@/utils/codeCard/sunlight';

export interface CodeCardPalette {
  sunlight: boolean;
  bg: string;
  surface: string;
  surfaceAlt: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  /** Hairline width: 1, or 2 in Sunlight. */
  rule: number;
  soft: string;
  accent: string;
  accentLabel: string;
  accentFill: string;
  accentSoft: string;
  success: string;
  successLabel: string;
  successSoft: string;
  warnLabel: string;
  warnSoft: string;
  /** The solid verdict block. */
  verdictBg: string;
  verdictInk: string;
  barOff: string;
  barOn: string;
  /** Text on accentFill. */
  onFill: string;
  /** Added to body sizes in Sunlight. */
  bump: number;
}

const SUN = {
  ground: '#FFFFFF',
  alt: '#ECEDE9',
  ink: '#000000',
  ink2: '#1E2226',
  ink3: '#30353A',
  line: '#2B3038',
  accent: '#1C4023',
  success: '#014A3F',
  barOff: '#9DA29A',
} as const;

export function codeCardPalette(t: ThemeColors, sunlight: boolean): CodeCardPalette {
  if (sunlight) {
    return {
      sunlight: true,
      bg: SUN.ground,
      surface: SUN.ground,
      surfaceAlt: SUN.alt,
      ink: SUN.ink,
      ink2: SUN.ink2,
      ink3: SUN.ink3,
      line: SUN.line,
      rule: 2,
      soft: SUN.alt,
      accent: SUN.accent,
      accentLabel: SUN.accent,
      accentFill: SUN.accent,
      accentSoft: SUN.alt,
      success: SUN.success,
      successLabel: SUN.success,
      successSoft: SUN.alt,
      warnLabel: '#8A3700',
      warnSoft: '#FFE9CC',
      verdictBg: SUN.ink,
      verdictInk: SUN.ground,
      barOff: SUN.barOff,
      barOn: SUN.ink,
      onFill: SUN.ground,
      bump: 2,
    };
  }
  return {
    sunlight: false,
    bg: t.bg,
    surface: t.surface,
    surfaceAlt: t.surfaceAlt,
    ink: t.text,
    ink2: t.textSecondary,
    ink3: t.textMuted,
    line: t.line,
    rule: 1,
    soft: t.neutralSoft,
    accent: t.accent,
    accentLabel: t.accentLabel,
    accentFill: t.accentFill,
    accentSoft: t.accentSoft,
    success: t.success,
    successLabel: t.successLabel,
    successSoft: t.successSoft,
    warnLabel: t.warningLabel,
    warnSoft: t.warningSoft,
    verdictBg: t.text,
    verdictInk: t.surface,
    barOff: t.line,
    barOn: t.textSecondary,
    onFill: '#FFFFFF',
    bump: 0,
  };
}

/** The stored Sunlight preference, live. */
export function useSunlight(): boolean {
  return useSyncExternalStore(subscribeSunlight, getSunlight, getSunlight);
}

/** The palette for a code-card component; `override` pins Sunlight on or off. */
export function useCodeCardPalette(override?: boolean): CodeCardPalette {
  const { colors } = useTheme();
  const stored = useSunlight();
  const sun = override ?? stored;
  // colors is one stable object per theme, so this rebuilds only on a theme
  // or Sunlight change, and the styles memoised on it follow.
  return useMemo(() => codeCardPalette(colors, sun), [colors, sun]);
}
