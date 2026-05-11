// ThemeContext — dark mode foundation for MAGE ID.
//
// What works today:
//   ✓ User picks 'light' | 'dark' | 'system' in Settings
//   ✓ StatusBar style adapts (iOS + Android)
//   ✓ System UI navigation bar adapts on Android
//   ✓ `useTheme()` hook returns the active mode for any component
//   ✓ Preference persists in AsyncStorage
//   ✓ Colors module is theme-aware via getters (constants/colors.ts).
//     Inline JSX styles that read Colors.text / Colors.surface get the
//     correct theme value on every render.
//   ✓ themeKey bumps on every theme change, forcing a top-level
//     re-mount. New screen mounts after the bump pick up the new
//     theme via Colors getters.
//
// Known limitation:
//   ✗ StyleSheet.create() captures Colors.* values at module-load
//     time. Files that put `color: Colors.text` inside StyleSheet.
//     create() keep their original (light) color even after a theme
//     change, because the file is only imported once per session.
//     The fix per file: read Colors at render time (inline JSX style)
//     or via useThemedColors() hook + recomputed styles.
//
//     Recently-touched files are progressively migrating to inline
//     overrides for the most-visible content (names, headings,
//     surfaces). Full migration is gradual.

import React, { useCallback, useEffect, useState } from 'react';
import { Appearance, type ColorSchemeName, Platform, StatusBar } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { setColorTheme } from '@/constants/colors';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'mage_theme_preference';

interface ThemeContextValue {
  /** What the user picked. 'system' means follow OS. */
  preference: ThemePreference;
  /** The actual mode in effect right now. Always 'light' or 'dark'. */
  resolved: ResolvedTheme;
  /** Update + persist the user's preference. */
  setPreference: (p: ThemePreference) => Promise<void>;
  /**
   * Increments each time `resolved` changes. Use as a `key` on a
   * wrapper around the screen tree to force a top-level re-mount on
   * theme change. Critical because StyleSheet.create captures static
   * Colors values at module-load time — only a fresh mount re-reads
   * inline color overrides.
   */
  themeKey: number;
}

function resolveTheme(pref: ThemePreference, system: ColorSchemeName): ResolvedTheme {
  if (pref === 'system') return system === 'dark' ? 'dark' : 'light';
  return pref;
}

export const [ThemeProvider, useTheme] = createContextHook<ThemeContextValue>(() => {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [systemScheme, setSystemScheme] = useState<ColorSchemeName>(() => Appearance.getColorScheme());
  const [themeKey, setThemeKey] = useState(0);

  // Load persisted preference on mount.
  useEffect(() => {
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setPreferenceState(stored);
        }
      } catch (err) {
        if (__DEV__) console.warn('[Theme] failed to load preference:', err);
      }
    })();
  }, []);

  // Subscribe to system color-scheme changes. Important on iOS where
  // Control Center → "Appearance" can flip without re-launching the app.
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme);
    });
    return () => sub.remove();
  }, []);

  const setPreference = useCallback(async (p: ThemePreference) => {
    setPreferenceState(p);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, p);
    } catch (err) {
      if (__DEV__) console.warn('[Theme] failed to persist preference:', err);
    }
  }, []);

  // On web, also flip the document-level color scheme so native form
  // controls (date pickers, scrollbars) adopt the right palette.
  const resolved = resolveTheme(preference, systemScheme);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  // Native: flip the StatusBar bar style so iOS clock + battery + Wi-Fi
  // indicators stay readable against the background. Android also gets
  // its translucent status bar updated. Done imperatively (not via a
  // <StatusBar> JSX) so it works regardless of which screen is mounted.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    StatusBar.setBarStyle(resolved === 'dark' ? 'light-content' : 'dark-content', true);
    if (Platform.OS === 'android') {
      StatusBar.setBackgroundColor(resolved === 'dark' ? '#0B0D10' : '#F2F2F7', true);
    }
  }, [resolved]);

  // Wire the global Colors module to the current theme + bump themeKey
  // so consumers wrapping their tree in `key={themeKey}` get a clean
  // re-mount on theme change. Important because StyleSheet.create
  // captures Colors values at module load — only a fresh mount picks
  // up inline color overrides.
  useEffect(() => {
    setColorTheme(resolved);
    setThemeKey(k => k + 1);
  }, [resolved]);

  return { preference, resolved, setPreference, themeKey };
});

/** Convenience hook for components that only need the resolved mode. */
export function useResolvedTheme(): ResolvedTheme {
  return useTheme().resolved;
}
