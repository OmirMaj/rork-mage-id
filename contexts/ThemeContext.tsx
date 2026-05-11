// ThemeContext — dark mode foundation for MAGE ID.
//
// Scope of this v1 (be honest with future-you):
//   ✓ User can pick 'light' | 'dark' | 'system' in Settings
//   ✓ StatusBar style adapts (iOS + Android)
//   ✓ System UI navigation bar adapts on Android
//   ✓ `useTheme()` hook returns the active mode for any component
//      that wants to branch on it
//   ✓ Preference persists in AsyncStorage
//
// Out of scope (genuinely needs follow-up work, weeks not hours):
//   ✗ Every Colors.surface / Colors.text reference auto-swaps to a
//     dark variant. The 149 screens use Colors.* as static module-
//     level constants; a true theme migration would either route
//     every consumer through a hook (large refactor) or make Colors
//     mutable in a way that triggers re-renders.
//
// What this means for the user today: toggling dark mode flips the
// status bar + nav bar instantly. The actual screen surfaces stay
// light until each surface is migrated. We're shipping the foundation
// so future screens can use theme-aware tokens.

import React, { useCallback, useEffect, useState } from 'react';
import { Appearance, type ColorSchemeName, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';

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
}

function resolveTheme(pref: ThemePreference, system: ColorSchemeName): ResolvedTheme {
  if (pref === 'system') return system === 'dark' ? 'dark' : 'light';
  return pref;
}

export const [ThemeProvider, useTheme] = createContextHook<ThemeContextValue>(() => {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [systemScheme, setSystemScheme] = useState<ColorSchemeName>(() => Appearance.getColorScheme());

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

  return { preference, resolved, setPreference };
});

/** Convenience hook for components that only need the resolved mode. */
export function useResolvedTheme(): ResolvedTheme {
  return useTheme().resolved;
}
