// app/+html.tsx — root HTML document wrapper for Expo Web (app.mageid.app).
//
// Audit-2026-05-21 W8 + W9 + W10 (MEDIUM): pre-fix the generated web
// HTML had no <meta name="description">, no <meta name="theme-color">,
// no <link rel="manifest">. Lighthouse a11y / SEO / best-practices all
// dinged the missing tags. Social share previews + browser tinting +
// PWA installability all degraded.
//
// Expo Router's official pattern is a `+html.tsx` at the app root that
// returns the full <html> document. The framework injects React Native
// Web's rendered content into <body>. Anything we put in <head> here
// ships on every server-rendered + statically-prerendered page.
//
// Reference: https://docs.expo.dev/router/reference/static-rendering/#root-html
//
// Note: per-route document.title overrides happen client-side via the
// useEffect block in app/_layout.tsx (audit W1 fix in the same commit
// batch). The <title> here is the default that renders during SSR /
// initial paint before the client hydrates.

import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';
import {
  THEME_BOOT_SCRIPT,
  WEB_DOCUMENT_CSS,
  WEB_DOCUMENT_STYLE_ID,
} from '@/components/desktop/webDocument';

const APP_NAME = 'MAGE ID';
const APP_DESCRIPTION = 'The operating system for general contractors — plans, estimates, daily reports, pay applications, and a live client portal. One app for the jobsite.';
const THEME_COLOR_INK = '#0B0D10';
const THEME_COLOR_AMBER = '#FF6A1A';

/**
 * Root HTML document for every page served by app.mageid.app.
 * Customize per-route <head> via useDocumentTitle (client-side) or a
 * future Head component. This file owns the static defaults that ship
 * in the prerendered HTML — they're what crawlers + share-as-link
 * previews + offline browsers see first.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />

        {/* SEO + share-link previews. The description shows up in
            Twitter / iMessage / Slack unfurl cards, Google search
            snippets, and browser bookmark previews. */}
        <meta name="description" content={APP_DESCRIPTION} />
        <meta name="application-name" content={APP_NAME} />
        <meta name="apple-mobile-web-app-title" content={APP_NAME} />

        {/* Browser chrome tint. Mobile browsers paint the address bar
            with this color; desktop browsers can show it in tab UI on
            certain themes. Ink (#0B0D10) matches the iOS launch
            screen + the marketing site. */}
        <meta name="theme-color" content={THEME_COLOR_INK} />
        <meta name="msapplication-TileColor" content={THEME_COLOR_INK} />

        {/* PWA manifest — declares the app's installability. Add-to-
            Home-Screen on iOS Safari / install prompt on Chrome
            desktop both honor this. */}
        <link rel="manifest" href="/manifest.webmanifest" />

        {/* Apple-specific PWA hints. Standalone mode hides the URL bar
            when launched from the home screen. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />

        {/* Open Graph + Twitter Card — for social share previews when
            someone shares the app URL (rare for an authed app but
            possible during sign-up referrals). */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={APP_NAME} />
        <meta property="og:description" content={APP_DESCRIPTION} />
        <meta property="og:site_name" content={APP_NAME} />
        <meta property="og:url" content="https://app.mageid.app" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={APP_NAME} />
        <meta name="twitter:description" content={APP_DESCRIPTION} />

        {/* Disable the iOS body scroll bounce in React Native Web —
            built-in Expo Router helper. */}
        <ScrollViewStyleReset />

        {/* Before-hydration theme + page ground + print stylesheet (wave
            6b). LIVE ONLY IF web.output becomes "static"/"server": the app
            exports as a single-page app today, and Expo then serves
            public/index.html and ignores this file. Both render the SAME
            strings from components/desktop/webDocument.ts, and
            validate-desktop-page-map pins public/index.html to them. */}
        <script id="mage-theme-boot" dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <style id={WEB_DOCUMENT_STYLE_ID} dangerouslySetInnerHTML={{ __html: WEB_DOCUMENT_CSS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

// Re-export the theme color so other places can reference it without
// duplicating the constant. (e.g., a future deep-link landing page.)
export { THEME_COLOR_INK, THEME_COLOR_AMBER, APP_NAME, APP_DESCRIPTION };
