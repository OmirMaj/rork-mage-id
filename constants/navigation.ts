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

/**
 * The themed chrome for a root-Stack route that shows the native header —
 * built at RENDER time from the resolved theme (wave 6b).
 *
 * Until wave 6b app/_layout.tsx spread a module-level NATIVE_HEADER_TITLE whose
 * colour was `Colors.text` read at module load (the light theme's black) onto
 * ~42 routes, next to a `Colors.background` bar. A dark-mode user therefore got
 * a black title on a dark bar. RootLayoutNav now calls this with colours taken
 * from useTheme() and spreads the result, so the header follows every theme
 * switch. The caller decides the colours; this only fixes the SHAPE, so the
 * typeface can never be dropped (validate-contrast check 11 is why).
 */
export function nativeHeaderOptions(c: { background: string; title: string; tint: string }) {
  return {
    headerStyle: { backgroundColor: c.background },
    headerTintColor: c.tint,
    headerTitleStyle: { ...NATIVE_HEADER_TITLE_FACE, color: c.title },
  } as const;
}
