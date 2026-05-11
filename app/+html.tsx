// +html.tsx — custom static HTML wrapper for the Expo web build.
//
// Expo Router SDK 50+ pattern: this file wraps every page's HTML output
// so we can inject proper SEO, OG/Twitter cards, theme color, favicons,
// and the PWA manifest. Without this, the Expo web build ships
// `<title>MAGE ID</title>` and nothing else — every shared deep link
// looks broken in iMessage / Slack / Twitter previews.
//
// What this fixes:
//   - Full title + meta description
//   - Open Graph + Twitter Card for shareable previews
//   - Theme color (matches splash/onboarding ink #0B0D10)
//   - Apple touch icon + favicon variants
//   - manifest.json link for PWA installability
//   - viewport-fit=cover so the app sits flush on iPhone notch
//   - body scroll re-enabled (Expo default sets overflow:hidden which
//     locks scrolling past viewport on every deep-linked route)
//
// Routes can still override the `<title>` via Stack.Screen options →
// expo-router pipes that through to a per-page title at render time.

import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

const TITLE = 'MAGE ID — Construction management for general contractors';
const DESCRIPTION =
  'Mobile-first construction management software for residential and small-commercial general contractors. AI estimating, AI takeoff, daily field reports, AIA pay applications, scheduling, client portal, and an AI permit Q&A agent covering 8 US metros. From $29/mo.';
const URL = 'https://app.mageid.app/';
const OG_IMAGE = 'https://mageid.app/assets/og-image.png';
const THEME_COLOR = '#0B0D10';

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

        {/* Core SEO */}
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <meta name="theme-color" content={THEME_COLOR} />
        <link rel="canonical" href={URL} />

        {/* Open Graph (Facebook, LinkedIn, iMessage previews) */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="MAGE ID" />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content={URL} />
        <meta property="og:image" content={OG_IMAGE} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="MAGE ID — The operating system for the jobsite." />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={TITLE} />
        <meta name="twitter:description" content={DESCRIPTION} />
        <meta name="twitter:image" content={OG_IMAGE} />

        {/* Favicon set — covers every platform's bookmark/tab icon */}
        <link rel="icon" type="image/png" sizes="32x32" href="/assets/images/favicon-32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/assets/images/favicon-32.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/assets/images/icon.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/assets/images/icon.png" />

        {/* PWA manifest — lets iOS Safari + Android Chrome install as
            an app on Home Screen. */}
        <link rel="manifest" href="/manifest.webmanifest" />

        {/* Apple-specific PWA hints — controls Home Screen behavior on
            iOS Safari "Add to Home Screen". */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="MAGE ID" />

        {/* Re-enable body scrolling. Expo's default ScrollViewStyleReset
            applies `body { overflow: hidden }` which locks every web
            route at viewport height — breaks any screen longer than
            the visible area. ScrollViewStyleReset is still applied to
            preserve internal ScrollView behavior on screens that need
            it; we just override the body lock. */}
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: bodyScrollOverride }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

// Override the Expo body scroll lock so direct-link landing on any
// route (e.g., /permit-qa or /project-detail?id=…) can actually scroll
// past the fold. Without this, web users hit a wall.
const bodyScrollOverride = `
  html, body {
    height: auto;
    min-height: 100%;
    overflow: auto;
  }
  body {
    background: #F2F2F7;
  }
  #root {
    flex: 1;
    min-height: 100vh;
  }
`;
