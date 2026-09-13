// ThemeContext — Phase 1 theme system.
//
// Persists the user's theme preference (light / dark / system) to
// AsyncStorage and exposes the resolved palette via useTheme(). All
// new UI components consume this — they MUST NOT import `Theme.light`
// or `Theme.dark` directly from constants/colors, because that would
// bypass the toggle.
//
// Default for new installs: 'system'. It used to be 'light' to match the
// marketing site, which meant a contractor whose phone is in dark mode got a
// bright cream app and had to find Settings → Appearance to undo it (hands-on
// UI pass 2026-09-07, finding 6). The dark palette is a real ink/amber theme,
// not an inversion — defaulting away from it threw away the better half of the
// work. Honour the OS until the user says otherwise.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import {
  Theme,
  setColorTheme,
  deriveAccentPalette,
  getCustomPrimary,
  subscribeCustomPrimary,
  type ThemeColors,
} from '@/constants/colors';

const STORAGE_KEY = 'mageid_theme';

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

function resolve(pref: ThemePref): ResolvedTheme {
  if (pref === 'system') {
    const sys = Appearance.getColorScheme();
    return sys === 'dark' ? 'dark' : 'light';
  }
  return pref;
}

export const [ThemeProvider, useTheme] = createContextHook(() => {
  const [pref, setPrefState] = useState<ThemePref>('system');
  // Resolve the OS scheme on the very first render, not in the effect below,
  // so a dark-mode phone never flashes the light palette before hydration.
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve('system'));

  // Hydrate stored preference on mount.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === 'light' || v === 'dark' || v === 'system') {
        setPrefState(v);
        setResolved(resolve(v));
      }
    });
  }, []);

  // When pref is 'system', re-resolve on OS appearance change.
  useEffect(() => {
    if (pref !== 'system') {
      setResolved(resolve(pref));
      return;
    }
    setResolved(resolve('system'));
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setResolved(colorScheme === 'dark' ? 'dark' : 'light');
    });
    return () => sub.remove();
  }, [pref]);

  const setPref = useCallback(async (p: ThemePref) => {
    setPrefState(p);
    await AsyncStorage.setItem(STORAGE_KEY, p);
  }, []);

  // The user's brand hue from Settings → APP THEME. It is set outside React
  // (constants/colors.ts holds it, so the non-themed `Colors.*` getters resolve
  // through the same value), by ThemeLoader on boot and by the picker on save —
  // so mirror it into state and rebuild the palette when it changes. Before
  // 2026-09-07 this context had no accent handling at all and returned
  // `Theme[resolved]` unmodified, which is why picking Navy recoloured about a
  // tenth of the app and the confirmation alert had to promise a restart that
  // would not have helped either (audit 2026-09-07, "Do next" 4).
  const [customPrimary, setCustomPrimaryState] = useState<string>(() => getCustomPrimary());
  useEffect(() => {
    // Re-read on subscribe as well as on notify. ThemeLoader sets the hue from
    // an AsyncStorage read, and nothing orders that read against this mount —
    // a write that lands between the useState initialiser above and this
    // subscription would otherwise be a notification with no listener, leaving
    // a user who has picked Navy on the brand palette until something else
    // re-rendered the provider (review 2026-09-07).
    setCustomPrimaryState(getCustomPrimary());
    return subscribeCustomPrimary(() => setCustomPrimaryState(getCustomPrimary()));
  }, []);

  // The accent family is DERIVED, not stored: `Theme[resolved]` deliberately
  // carries no accent tokens, and only this merge is a complete ThemeColors.
  const colors: ThemeColors = useMemo(
    () => ({ ...Theme[resolved], ...deriveAccentPalette(customPrimary, resolved) }),
    [resolved, customPrimary],
  );

  // Mirror the resolved theme into the static Colors module so any
  // file that reads `Colors.surface` / `Colors.text` / etc. (instead
  // of going through useTheme()) automatically picks up dark-mode
  // values. Critical for screens that haven't been migrated yet —
  // see Phase 26 comment in constants/colors.ts.
  useEffect(() => {
    setColorTheme(resolved);
  }, [resolved]);

  return useMemo(
    () => ({ pref, resolved, colors, setPref }),
    [pref, resolved, colors, setPref],
  );
});
