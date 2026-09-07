// constants/navigation.ts
//
// Chrome that the NATIVE stack header owns, shared by every route that shows
// one. It lives in constants/ rather than in app/_layout.tsx so a screen can
// import it without importing a route module.
//
// Runtime audit 2026-09-06, VIS-18: `<Stack screenOptions>` set no default
// headerTitleStyle, and 27 screens each declared their own as
// `{ fontWeight: '700', color: themeColors.text }`. React Navigation merges
// screen options SHALLOWLY — a screen's headerTitleStyle REPLACES the parent's
// rather than merging into it — so all 27 silently dropped the app typeface and
// rendered their titles in the system face. Moving one tap from a Fraunces-
// titled financial screen to Payments changed the title's typeface mid-flow.
//
// Spread this and add the colour:
//     headerTitleStyle: { ...NATIVE_HEADER_TITLE_FACE, color: themeColors.text }
//
// scripts/validate-contrast.ts check 11 fails the build if a headerTitleStyle
// appears anywhere without a typeface.

import { Type } from '@/constants/typography';

/**
 * Typeface only — no colour, so each screen supplies its own live themed one
 * rather than inheriting a value frozen at module-load.
 *
 * Written out longhand rather than spreading Type.headline because
 * @react-navigation/native-stack only honours fontFamily / fontSize /
 * fontWeight / color here; lineHeight and letterSpacing are silently dropped,
 * so spreading the whole token would imply precision the platform ignores.
 * No fontWeight: Fraunces_700Bold already carries it, and doubling up makes
 * the platform synthesise a fake bold over a real one.
 */
export const NATIVE_HEADER_TITLE_FACE = {
  fontFamily: 'Fraunces_700Bold',
  fontSize: Type.headline.fontSize,   // 17pt — the native header size
} as const;
