// designTokens — explicit tokens for spacing, radius, shadow, motion.
//
// Why this exists: an audit of the codebase found 23 distinct fontSize
// values, 30+ borderRadius values, and dozens of unique shadow recipes
// scattered across 200+ files. Research on 2026-grade SaaS apps shows
// the polished bar is **6-8 fontSizes, 2 radii per surface, and 3
// shadow tiers across the whole app.** This module locks the rest of
// our design system to that bar.
//
// Adoption strategy:
//   1. New components reference `Tokens.spacing.md` instead of `12`,
//      `Tokens.radius.lg` instead of `14`, `Tokens.shadow.medium`
//      spread into the component's style instead of inline shadow props.
//   2. Existing components migrate gradually. Audit grep-able by
//      searching for `padding: <num>` / `borderRadius: <num>` literals.
//
// Companion files:
//   - constants/colors.ts (already a tokens system)
//   - constants/typography.ts (already a tokens system)
//
// Together these three give MAGE the same spec discipline that Linear,
// Cash App, Things 3, and Mercury ship with.

import { Platform, type ViewStyle } from 'react-native';

// ─────────────────────────────────────────────────────────────────────
// Spacing — 4-point grid. Universal in 2026.
// ─────────────────────────────────────────────────────────────────────
//
// Polished apps use ≤6 spacing values per screen. The full scale below
// is the *vocabulary*; pick a few per surface and stick to them.
export const Spacing = {
  /** 2pt — hairline gaps inside dense rows. */
  hairline: 2,
  /** 4pt — sub-element padding (icon + label inside a chip). */
  xxs: 4,
  /** 8pt — chip padding, list-row internal gaps. */
  xs: 8,
  /** 12pt — card internal padding, default vertical row spacing. */
  sm: 12,
  /** 16pt — default screen padding, card padding. */
  md: 16,
  /** 20pt — section spacing. */
  lg: 20,
  /** 24pt — block separation, modal internal gutters. */
  xl: 24,
  /** 32pt — major section breaks. */
  '2xl': 32,
  /** 40pt — hero spacing. */
  '3xl': 40,
  /** 56pt — splash / onboarding hero spacing. */
  '4xl': 56,
} as const;

// ─────────────────────────────────────────────────────────────────────
// Border radius — Apple iOS continuous corners.
// ─────────────────────────────────────────────────────────────────────
//
// 2026 norm: 2 radii per surface. Use Apple's `borderCurve: 'continuous'`
// (squircle) on every Pressable — it's a polish marker that distinguishes
// premium iOS apps from web-derived ones. Default RN `borderRadius` gives
// circular arcs which read as crude on iOS.
export const Radius = {
  /** 6pt — small chips, inline pills. */
  xs: 6,
  /** 8pt — input fields, secondary buttons. */
  sm: 8,
  /** 10pt — list rows, default cards. */
  md: 10,
  /** 12pt — 4pt-grid card radius. The most common in-between value in
   *  the codebase (384 uses); recognized as a first-class token rather
   *  than rounded. Sits between md and lg in the scale. */
  card: 12,
  /** 14pt — primary cards, panels. */
  lg: 14,
  /** 16pt — 4pt-grid panel radius. Common across modal sheets and
   *  full-width cards (133 uses). */
  panel: 16,
  /** 18pt — sheets, modals. */
  xl: 18,
  /** 24pt — bottom-sheet handles, splash CTAs. */
  '2xl': 24,
  /** 999 — fully rounded (pills, avatars). */
  full: 999,
} as const;

/** Apple continuous-corners property. Spread alongside borderRadius on
 *  every Pressable for the iOS squircle look. No-op on Android. */
export const continuousCorners: Pick<ViewStyle, 'borderCurve'> = Platform.select({
  ios: { borderCurve: 'continuous' as const },
  default: {},
}) as Pick<ViewStyle, 'borderCurve'>;

// ─────────────────────────────────────────────────────────────────────
// Shadows — 3 tiers, max.
// ─────────────────────────────────────────────────────────────────────
//
// Ranked by elevation (subtle = resting, heavy = floating). Premium apps
// use exactly 3; hobby apps invent shadows in every component file.
//
// On web, the same tokens render via `boxShadow`. On iOS / Android the
// platform-specific keys drive the look. Apply via `style={[..., Shadow.subtle]}`.
export const Shadow = {
  /** Resting card — barely-there, separates surface from background. */
  subtle: Platform.select({
    web: { boxShadow: '0 1px 2px rgba(0,0,0,0.04)' } as ViewStyle,
    default: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.04,
      shadowRadius: 2,
      elevation: 1,
    } as ViewStyle,
  })!,
  /** Pressed / hovered card — slight lift. */
  medium: Platform.select({
    web: { boxShadow: '0 4px 12px rgba(0,0,0,0.08)' } as ViewStyle,
    default: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
      elevation: 3,
    } as ViewStyle,
  })!,
  /** Modals, sheets, floating buttons. */
  heavy: Platform.select({
    web: { boxShadow: '0 16px 32px rgba(0,0,0,0.16)' } as ViewStyle,
    default: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.16,
      shadowRadius: 32,
      elevation: 8,
    } as ViewStyle,
  })!,
} as const;

// ─────────────────────────────────────────────────────────────────────
// Motion — durations + easing.
// ─────────────────────────────────────────────────────────────────────
//
// Apple iOS 17+ defaults: spring physics for direct manipulation,
// 250-350ms ease-out for transitions. Premium apps never use linear.
export const Motion = {
  duration: {
    /** Micro: button press, ripple. ≤150ms. */
    micro: 120,
    /** Component: modal slide, drawer, sheet detent. */
    base: 280,
    /** Page transition. Most apps shouldn't override Expo Router's. */
    page: 350,
    /** Long: full-screen state changes (rare). */
    slow: 500,
  },
  /** Bezier curves — only ease-out for entries, ease-in for exits.
   *  `decelerate` was the iOS-default ease-out [0,0,0.2,1] — replaced
   *  with the marketing site's signature curve so app + web feel like
   *  the same product. Subtle but every entry animation gets +10%
   *  character. */
  easing: {
    standard: [0.4, 0.0, 0.2, 1] as const,     // ease-in-out
    decelerate: [0.16, 1.0, 0.3, 1] as const,  // brand entry curve (marketing landing.css)
    accelerate: [0.4, 0.0, 1, 1] as const,     // ease-in (exits)
  },
  /** Reanimated spring presets — use these instead of timings on press
   *  states. Apple iOS feels-spring-physics is what makes things feel
   *  alive vs canned. */
  spring: {
    /** Tap feedback on a button — fast, snappy. */
    snap: { damping: 14, stiffness: 220, mass: 0.8 },
    /** Modal / sheet — settled, deliberate. */
    settled: { damping: 22, stiffness: 180, mass: 1 },
    /** Heavy element (card flip, big drawer). */
    heavy: { damping: 28, stiffness: 140, mass: 1.4 },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────
// Touch target — min hit area for a tappable element.
// ─────────────────────────────────────────────────────────────────────
//
// Apple HIG floor: 44pt. Premium 2026 bar: 48pt for primary actions.
// Pair with `hitSlop` for icons that visually need to be smaller.
export const TouchTarget = {
  min: 44,
  comfortable: 48,
  large: 56,
} as const;

// Tokens — a barrel export for callers who want one symbol.
export const Tokens = {
  spacing: Spacing,
  radius: Radius,
  shadow: Shadow,
  motion: Motion,
  touchTarget: TouchTarget,
  continuousCorners,
} as const;

export default Tokens;
