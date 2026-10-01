// webLaunch.ts — the web launch's light / dark scheme and its styles (lane
// LOADERDESK).
//
// The web launch (the pre-JS still in public/index.html, BrandSplash,
// BootShell, and LevelMark's splash tone on the web) takes the scheme the app
// is about to resolve, so a dark-mode user never cuts from a light launch to
// the dark app. The resolution is utils/levelDesk.ts webLaunchScheme (pure):
// the page's data-theme tag — written before first paint by the theme-boot
// script from the stored mageid_theme pref, else the OS — and the OS
// prefers-color-scheme when the tag is absent. This file is the one DOM read.
//
// Native never calls readWebLaunchScheme and never reads WEB_LAUNCH_STYLES:
// the native splash is the baked PNG replica (NATIVE_SPLASH_*). Tokens only.

import { StyleSheet } from 'react-native';
import { Type } from '@/constants/typography';
import {
  DESK_SPLASH, WEB_LAUNCH, WEB_LAUNCH_DARK, webLaunchScheme, type LaunchScheme, type WebLaunchColors,
} from '@/utils/levelDesk';

/** The launch scheme on the web: the data-theme tag, else the OS. 'light' when neither is readable. */
export function readWebLaunchScheme(): LaunchScheme {
  try {
    const tag = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null;
    const osDark = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return webLaunchScheme(tag, osDark);
  } catch {
    return 'light';
  }
}

function launchStyles(c: WebLaunchColors) {
  return StyleSheet.create({
    // The launch ground: BrandSplash's ink field and BootShell's root.
    ink: { backgroundColor: c.bg },
    root: { flex: 1, backgroundColor: c.bg },
    // The web phone and tablet: the native wordmark's face, size and tracking.
    wordmarkWeb: {
      ...Type.serifTitle,
      letterSpacing: 3.4,
      color: c.fg,
      textAlign: 'center',
    },
    // Laptop and monitor: Type.serifLargeTitle (36 / 42), wider tracking.
    wordmarkLarge: {
      ...Type.serifLargeTitle,
      letterSpacing: DESK_SPLASH.laptop.tracking,
      color: c.fg,
      textAlign: 'center',
    },
  });
}

/** The web launch styles per scheme: BrandSplash and BootShell share them, so the hand-back never changes a colour. */
export const WEB_LAUNCH_STYLES = { light: launchStyles(WEB_LAUNCH), dark: launchStyles(WEB_LAUNCH_DARK) } as const;
