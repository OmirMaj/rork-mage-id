// colors.ts: the Commit Capsule's colour roles, resolved from the live theme
// (moments wave, lane CAPSULE).
//
// Pure: it takes ThemeColors and hands back token VALUES, never a literal
// colour, so the green rebrand (and a user's custom accent) flows through with
// no change here. `import type` is erased, so bun still loads this file.
//
// The one judgement call is onFill, the ink on a solid fill: white on the light
// theme, the theme's own dark ground on the dark theme. White on the green
// build's dark accent measures 2.4:1, so a dark fill takes c.bg.

import type { ThemeColors } from '@/constants/colors';

/** There is NO destructive/danger commit tone. Ever. A void or delete never gets a slide. */
export type CapsuleTone = 'brand' | 'ink' | 'warning';

export interface MomentColors {
  rail: string; rim: string; lockRim: string; label: string; labelShimmer: string; busy: string;
  capFill: Record<CapsuleTone, string>; capOn: Record<CapsuleTone, string>;
  success: string; onSuccess: string; danger: string; onDanger: string;
  neutralBase: string; neutralTint: string; neutralTintOpacity: number; onNeutral: string;
  reasonDanger: string; reasonWarning: string; focus: string;
  ink: string; canvas: string; groove: string; grooveWarm: string; signedLine: string; seal: string; sealFace: string;
}

export function momentColors(c: ThemeColors, resolved: 'light' | 'dark'): MomentColors {
  const light = resolved === 'light';
  const onFill = light ? c.surface : c.bg;
  return {
    rail: c.surfaceAlt,
    rim: c.line,
    lockRim: c.accent,
    label: c.textSecondary,
    labelShimmer: c.text,
    busy: c.textSecondary,
    capFill: { brand: light ? c.accentFill : c.accent, ink: c.text, warning: c.warningLabel },
    capOn: { brand: onFill, ink: c.surface, warning: onFill },
    success: c.success,
    onSuccess: onFill,
    danger: c.danger,
    onDanger: onFill,
    // Queued / timeout / disabled: an OPAQUE layer (surfaceAlt) with a static
    // textMuted tint on top, so a cross-fade never lets the brand fill through.
    neutralBase: c.surfaceAlt,
    neutralTint: c.textMuted,
    neutralTintOpacity: 0.28,
    onNeutral: c.text,
    reasonDanger: c.dangerLabel,
    reasonWarning: c.warningLabel,
    focus: c.accent,
    ink: c.text,
    canvas: c.surface,
    groove: c.line,
    grooveWarm: c.textSecondary,
    signedLine: c.text,
    seal: c.success,
    sealFace: c.surface,
  };
}
