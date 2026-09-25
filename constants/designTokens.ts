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
  /** Bezier curves — only ease-out for entries, ease-in for exits. */
  easing: {
    standard: [0.4, 0.0, 0.2, 1] as const,    // ease-in-out
    decelerate: [0.0, 0.0, 0.2, 1] as const,  // ease-out (entries)
    accelerate: [0.4, 0.0, 1, 1] as const,    // ease-in (exits)
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

// ─────────────────────────────────────────────────────────────────────
// Icon size + stroke vocabulary — locked to 4 named sizes.
// ─────────────────────────────────────────────────────────────────────
//
// Premium apps use ~4 icon sizes with paired stroke weights. Free-form
// icon sizing produces the "flat / generic" feel — strokes that are too
// thin on small icons read as anemic, and decorative icons without
// backgrounds feel like wireframes.
//
// Usage:
//   import { IconSize } from '@/constants/designTokens';
//   <ChevronRight {...IconSize.small} color={colors.textMuted} />
//
// Each entry spreads size + strokeWidth onto a lucide-react-native icon.
export const IconSize = {
  /** 12pt @ 2.2 — micro icons inside dense rows (status pills, count chips). */
  micro:   { size: 12, strokeWidth: 2.2 },
  /** 14pt @ 2.0 — chevrons, metadata icons, secondary actions. */
  small:   { size: 14, strokeWidth: 2.0 },
  /** 18pt @ 1.8 — workhorse for primary row icons, buttons, nav. */
  default: { size: 18, strokeWidth: 1.8 },
  /** 24pt @ 2.0 — hero icons on empty states, modals, paywall tiers. */
  large:   { size: 24, strokeWidth: 2.0 },
} as const;

// ─────────────────────────────────────────────────────────────────────
// Content widths — how wide a card column may grow on a desktop browser.
// ─────────────────────────────────────────────────────────────────────
//
// On web the routed content is 1400 wide (useResponsiveLayout.contentMaxWidth)
// and Schedule Pro is full-bleed, so a stack of flex:1 cards stretched to
// 1,368px (the Schedule tab's Today view, measured on app.mageid.app at a
// 2056px window, 2026-09-23) and to the whole monitor in Pro — one-line
// banners 1,300px long, four stat tiles 500px each. The founder: "the boxes
// are so stretched out and it looks terrible". Card and list views sit in a
// centred column of these widths; timelines and grids (Gantt, List) keep the
// full width because their content really is that wide. Below the cap the
// column is simply 100%, so phones and tablets are unchanged.
export const ContentWidth = {
  /** Stacked cards and single-column lists (Today, Lookahead, Board rows, a dashboard). */
  reading: 1040,
  /** Side-by-side columns that each need a card's width (a kanban board). */
  board: 1280,
} as const;

// Wave 6c folds ContentWidth into Layout.page (board 1280 = dashboard; reading 1040 has no
// Layout twin yet — a decision for 6c). Until then both exist; new code uses Layout.

// Layout — desktop web only (wave 6b visual system). The web app was the phone
// app stretched across a monitor: pages 1816 px wide, 1,360 px buttons, 1,000 px
// number boxes. These are the widths a desktop layout snaps to. Every value is
// read ONLY behind useResponsiveLayout().isDesktop (web >= 900 CSS px), so the
// iPhone app never reads one. No colours here — they carry over to any rebrand.
export const Layout = {
  // Content-column maxWidth, centred. 'bleed' (no cap) is expressed by omission.
  page:  { auth: 480, form: 760, reading: 760, dashboard: 1280, table: 1600 },
  prose: 680, // any Text that can wrap past one line
  gutter: 24, sectionGap: 24, groupGap: 16, cardPad: 16, rowGap: 8,
  sheet: { dialog: 440, form: 560, wide: 720, panel: 880 },
  menu:  { minWidth: 220, maxWidth: 280, offset: 4 },
  control: { sm: 32, md: 40, lg: 48, input: 40, textAreaMin: 96, toolbar: 48, row: 40, tableHeader: 32 },
  button:  { minWidth: { sm: 72, md: 96, lg: 120 }, maxWidth: 280, fullWidthMax: 400 },
  segment: { height: 32, minWidth: 88, maxWidth: 200, controlMax: 640, numeric: 56 },
  chip:    { height: 32, maxWidth: 240 },
  field:   { xs: 120, sm: 200, md: 360, lg: 560, search: 480 },
  // The desktop sidebar: the full rail, and the 64 px icon rail it collapses
  // to (canvas routes default to it — utils/sidebarRail.ts). Wave 6c.
  sidebar: { full: 240, rail: 64 },
  tile: {
    action:  { min: 200, maxCols: 6, gap: 10, minHeight: 56 },
    kpi:     { min: 220, maxCols: 4, gap: 12 },
    nav:     { min: 320, maxCols: 3, gap: 12 },
    content: { min: 380, maxCols: 3, gap: 16 },
  },
} as const;

export type LayoutPageType = keyof typeof Layout.page | 'bleed';

// Tokens — a barrel export for callers who want one symbol.
export const Tokens = {
  spacing: Spacing,
  radius: Radius,
  shadow: Shadow,
  motion: Motion,
  touchTarget: TouchTarget,
  iconSize: IconSize,
  contentWidth: ContentWidth,
  continuousCorners,
  layout: Layout,
} as const;

export default Tokens;
