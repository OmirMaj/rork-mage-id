// Typography tokens — Apple iOS scale, adapted for our app.
//
// Why this exists: audit found 23 distinct fontSize values across 5,400+
// occurrences with no scale system. The 13/14/15 cluster (1,341 usages)
// was three sizes doing the same job. fontWeight '700' was used 1,058
// times, '800' another 378 — body text was bold by default, which means
// nothing was emphasized. Boldness is currency; we'd spent it all.
//
// This module locks the type system to a documented scale. New code
// imports from here; legacy code can migrate gradually. Each token is a
// `TextStyle`-compatible object you can spread into a style array.
//
// Usage:
//   import { Type } from '@/constants/typography';
//   <Text style={[Type.body, { color: Colors.text }]}>Hello</Text>
//
// Scale follows Apple's iOS Human Interface Guidelines text styles, with
// a couple of compact variants we use for dense list rows.

import type { TextStyle } from 'react-native';

// Allowed weights. Keep this list short — every weight is currency.
//   400 (regular)  — body copy, the default. Use it like 90% of the time.
//   500 (medium)   — soft emphasis, status labels, captions that need authority.
//   600 (semibold) — section headings, important inline text.
//   700 (bold)     — display titles, primary CTAs. Reserve for the loudest text on screen.
type Weight = '400' | '500' | '600' | '700';

const w = (n: Weight) => n;

export const Type = {
  // Display — used for the largest titles on a screen (e.g., "Your Projects").
  // Apple "Large Title" — 34/41/700.
  largeTitle: { fontSize: 34, fontWeight: w('700'), letterSpacing: -0.5, lineHeight: 41 } as TextStyle,

  // Section + screen titles, hero numbers in stat cards.
  title1: { fontSize: 28, fontWeight: w('700'), letterSpacing: -0.4, lineHeight: 34 } as TextStyle,
  title2: { fontSize: 22, fontWeight: w('700'), letterSpacing: -0.3, lineHeight: 28 } as TextStyle,
  title3: { fontSize: 20, fontWeight: w('600'), letterSpacing: -0.2, lineHeight: 25 } as TextStyle,

  // Headlines for cards / list rows that need a step up from body.
  headline: { fontSize: 17, fontWeight: w('600'), lineHeight: 22 } as TextStyle,

  // Body — the default. Use this for almost everything that's not a
  // heading, label, or caption.
  body: { fontSize: 17, fontWeight: w('400'), lineHeight: 22 } as TextStyle,
  bodyEmphasized: { fontSize: 17, fontWeight: w('600'), lineHeight: 22 } as TextStyle,

  // Slightly smaller body — secondary descriptions, longer-form text in
  // dense rows.
  callout: { fontSize: 16, fontWeight: w('400'), lineHeight: 21 } as TextStyle,
  subhead: { fontSize: 15, fontWeight: w('400'), lineHeight: 20 } as TextStyle,
  subheadEmphasized: { fontSize: 15, fontWeight: w('600'), lineHeight: 20 } as TextStyle,

  // Footnote — fine print, secondary metadata under a row.
  footnote: { fontSize: 13, fontWeight: w('400'), lineHeight: 18 } as TextStyle,
  footnoteEmphasized: { fontSize: 13, fontWeight: w('600'), lineHeight: 18 } as TextStyle,

  // Compact body — used heavily as the in-between size on dense UIs
  // (532 inline `fontSize: 14` uses in the codebase). Sits between
  // footnote (13) and subhead (15). Recognized as a first-class token.
  bodyCompact: { fontSize: 14, fontWeight: w('400'), lineHeight: 19 } as TextStyle,
  bodyCompactEmphasized: { fontSize: 14, fontWeight: w('600'), lineHeight: 19 } as TextStyle,

  // Subheadline — between body (17) and title3 (20). 107 inline uses.
  subheadline: { fontSize: 18, fontWeight: w('600'), lineHeight: 23 } as TextStyle,

  // Captions — eyebrow tags, micro labels above a stat. Use sparingly.
  caption1: { fontSize: 12, fontWeight: w('400'), lineHeight: 16 } as TextStyle,
  caption2: { fontSize: 11, fontWeight: w('400'), lineHeight: 13 } as TextStyle,

  // Eyebrow — tiny uppercase tag above a heading. Used for category
  // labels in cards (e.g., "CHANGE ORDER" above "+$4,240").
  eyebrow: {
    fontSize: 11,
    fontWeight: w('700'),
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
    lineHeight: 14,
  } as TextStyle,

  // ─── Display (Barlow) — screen titles and numbers that matter.
  //
  // REBRAND 2026-09-16: the display face moved from Fraunces to Barlow. A
  // serif display over a warm cream ground is one of the most recognisable
  // generated-app looks, so the face changed with the colour. Barlow is a
  // grotesk drawn from California highway signage — plain, upright, legible at
  // a distance, which is the voice a construction tool should have.
  //
  // THE NAMES STAY `serif*`. They are consumed by 19 screen/component files
  // and pinned by scripts/validate-type-identity.ts and validate-contrast.ts,
  // none of which this change owns; renaming them here would break the build
  // for everyone mid-rebrand. Read `serif*` as "display" — a rename to
  // `display*` is a mechanical follow-up once the consumers can move together.
  //
  // WEIGHT: SemiBold 600 throughout. Bold 700 reads heavy at 64pt and turns a
  // screen title into a shout; 600 is the confident-signage weight. Bold is
  // loaded too (DISPLAY_FONT.bold) for a wordmark that wants it.
  //
  // METRICS, re-derived rather than carried over. Barlow's line box is 1.20em
  // (hhea ascender 1000 / descender -200 on a 1000 upm) and its cap height is
  // 0.70em; Fraunces carried 1.23em and tight negative tracking to pull a
  // high-contrast serif together. Barlow is already narrow, and the same
  // tracking crowds it — at -1.6 on 64pt the hero digits touched. So tracking
  // is roughly -1% at the largest sizes, tapering to 0 by 22pt, and lineHeight
  // is ≥1.06em everywhere: caps and digits top out at 0.70em, so nothing
  // clips, where Fraunces' 62-on-64 hero relied on the serif's own metrics.
  serifHero:       { fontFamily: 'Barlow_600SemiBold', fontSize: 64, lineHeight: 68, letterSpacing: -0.64 } as TextStyle,
  serifLargeTitle: { fontFamily: 'Barlow_600SemiBold', fontSize: 36, lineHeight: 42, letterSpacing: -0.36 } as TextStyle,
  serifTitle:      { fontFamily: 'Barlow_600SemiBold', fontSize: 28, lineHeight: 34, letterSpacing: -0.14 } as TextStyle,
  // SCREEN TITLES USE THIS. The rule, so the app reads as one product rather
  // than 165 separately-built screens:
  //
  //   • The display face (Barlow) for screen titles and for NUMBERS THAT
  //     MATTER (margin %, money totals, counts you want someone to feel).
  //   • System sans for everything else — labels, body, controls, data rows.
  //
  // 22/28 is sized for an in-app header row that also carries a back button and
  // an action. Barlow sets narrower than Fraunces did at 22pt, so a title that
  // held one line before holds it with room to spare; the 2pt of extra line
  // height is the 1.2em box, not decoration.
  //
  // Do NOT pair it with fontWeight: Barlow_600SemiBold already carries its
  // weight, and an override makes the platform synthesise a fake bold on top
  // of a real one (muddy on iOS, ignored on some Android builds).
  //
  // Pinned by test:type-identity.
  serifHeadline:   { fontFamily: 'Barlow_600SemiBold', fontSize: 22, lineHeight: 28, letterSpacing: 0 } as TextStyle,

  // ─── Mono (JetBrains Mono) — micro labels, eyebrows, status.
  monoEyebrow: {
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.54, // 0.14em at 11px
    textTransform: 'uppercase' as const,
  } as TextStyle,
  monoLabel: {
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.8, // 0.18em at 10px
    textTransform: 'uppercase' as const,
  } as TextStyle,
  monoCaption: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.72, // 0.06em at 12px
  } as TextStyle,
} as const;

export type TypeKey = keyof typeof Type;

/**
 * The display face's loaded family names, for the few places that cannot spread
 * a Type token (a native header's fontFamily, a PDF/HTML template, a splash
 * wordmark). Each must be a key app/_layout.tsx passes to useFonts — an
 * unloaded family silently falls back to the system face.
 */
export const DISPLAY_FONT = {
  semibold: 'Barlow_600SemiBold',
  bold: 'Barlow_700Bold',
} as const;
