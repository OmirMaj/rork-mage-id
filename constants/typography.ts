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

  // ─── Serif (Fraunces) — display use only. Using 700 weight for strong
  //     contrast in both light and dark themes (500 felt too thin against
  //     ink in dark mode). 500 is also loaded if needed for soft headings.
  serifLargeTitle: { fontFamily: 'Fraunces_700Bold', fontSize: 36, lineHeight: 40, letterSpacing: -0.9 } as TextStyle,
  serifTitle:      { fontFamily: 'Fraunces_700Bold', fontSize: 28, lineHeight: 32, letterSpacing: -0.56 } as TextStyle,
  serifHeadline:   { fontFamily: 'Fraunces_700Bold', fontSize: 22, lineHeight: 26, letterSpacing: -0.22 } as TextStyle,

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
