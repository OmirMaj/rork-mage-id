// webDocument.ts — the web page's document-level CSS and boot script, in one
// place (wave 6b).
//
// WHY THIS FILE EXISTS. The web app builds as a single-page app (app.json
// `expo.web` has no `output`, so SDK 54 exports "single"), and in that mode
// Expo IGNORES app/+html.tsx: the served index.html is `public/index.html`
// when it exists, otherwise Expo's built-in template. So rules written only in
// +html never reach a browser — the wave-6b review proved it by exporting the
// app and finding none of them in dist/index.html.
//
// The strings below are therefore the single source for two homes:
//   - public/index.html — what the SPA actually serves (dev server and
//     `expo export`). It is a static file, so it carries a verbatim copy, and
//     scripts/validate-desktop-page-map.ts fails if the copy drifts from these
//     strings (or from the Theme tokens they are built from).
//   - app/+html.tsx — only live if web.output ever becomes "static"/"server";
//     it renders these same strings so the two can never disagree.
//
// Pure module (type-free, imports only the colour tokens) so bun validators
// can load it.

import { Theme } from '@/constants/colors';

/** The AsyncStorage key contexts/ThemeContext persists the preference under.
 *  On web AsyncStorage IS window.localStorage, stored as the raw string. */
export const THEME_STORAGE_KEY = 'mageid_theme';

/**
 * Before-hydration theme. Runs before first paint and tags <html
 * data-theme>, resolving exactly like contexts/ThemeContext: a stored
 * 'light' / 'dark' wins, anything else ('system' or nothing) follows the OS.
 * Without it an OS in light mode paints the light body under a user who picked
 * Dark in Settings — a light flash on every load. RootLayoutNav keeps the tag
 * in step after hydration. try/catch: a blocked localStorage must never stop
 * the page loading; the media-query fallback in THEME_BODY_CSS then applies.
 */
export const THEME_BOOT_SCRIPT = [
  '(function () {',
  '  try {',
  `    var p = window.localStorage.getItem('${THEME_STORAGE_KEY}');`,
  "    var dark = p === 'dark' || (p !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);",
  "    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');",
  '  } catch (e) {}',
  '})();',
].join('\n');

/**
 * Page ground per theme, from the theme tokens (t.bg), so the body, the
 * desktop native header and the page-frame margins are one colour. The media
 * query is the fallback for when the boot script could not run; the
 * data-theme rules win whenever it did (higher specificity).
 */
export const THEME_BODY_CSS = [
  `body { background-color: ${Theme.dark.bg}; }`,
  `@media (prefers-color-scheme: light) { body { background-color: ${Theme.light.bg}; } }`,
  `html[data-theme='dark'] body { background-color: ${Theme.dark.bg}; }`,
  `html[data-theme='light'] body { background-color: ${Theme.light.bg}; }`,
].join('\n');

/**
 * Print (Cmd+P). Two jobs:
 *
 * 1. The shell must not reach paper: the primary <nav> (DesktopSidebar's
 *    accessibilityRole="navigation" + label), the right-hand dock, the
 *    floating sync pill and anything a screen tags data-print="hide" (FABs,
 *    rails, sticky footers — wave 6c tags its own).
 *
 * 2. The whole page must print, not one window of it. react-native-web locks
 *    html/body/#root to the window with overflow:hidden and every ScrollView
 *    is its own overflow:auto box, so without this Chrome prints the visible
 *    viewport and a blank second sheet. Releasing OVERFLOW (not height) lets
 *    the scroll content run on across sheets.
 *
 *    Heights are deliberately left alone. native-stack screens on web are
 *    StyleSheet.absoluteFill boxes, so `height:auto` on their ancestors
 *    collapses the stack to 0 px: the content still prints (it overflows),
 *    but every bottom-anchored footer jumps to the top of sheet 1 and prints
 *    over the page title. Keeping the heights keeps the screen one window
 *    tall, so a footer prints where the user saw it.
 *
 * Measured, not assumed: a headless-Chrome Page.printToPDF of the exported
 * SPA (/signup lengthened to 3,700 px, with an injected sidebar <nav> and two
 * absolute footers) — this CSS printed 4 sheets with every line, no nav, the
 * untagged footer at the bottom of sheet 1 and the tagged one gone; with no
 * release it printed 1 clipped sheet + 1 blank; with `height:auto` the
 * untagged footer printed over the title.
 */
export const PRINT_CSS = [
  '@media print {',
  '  html, body, #root {',
  '    overflow: visible !important;',
  '  }',
  '  #root div {',
  '    overflow: visible !important;',
  '    max-height: none !important;',
  '  }',
  "  nav[aria-label='Primary navigation'],",
  '  #mage-shell-dock,',
  '  #mage-sync-pill,',
  "  [data-print='hide'] {",
  '    display: none !important;',
  '  }',
  '}',
].join('\n');

/** The id of the <style> element that carries THEME_BODY_CSS + PRINT_CSS. */
export const WEB_DOCUMENT_STYLE_ID = 'mage-document';

/** The full <style> body, exactly as public/index.html carries it. */
export const WEB_DOCUMENT_CSS = THEME_BODY_CSS + '\n' + PRINT_CSS;
