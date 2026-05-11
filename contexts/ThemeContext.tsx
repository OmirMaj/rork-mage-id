// ThemeContext — Phase 1 theme system.
//
// Persists the user's theme preference (light / dark / system) to
// AsyncStorage and exposes the resolved palette via useTheme(). All
// new UI components consume this — they MUST NOT import `Theme.light`
// or `Theme.dark` directly from constants/colors, because that would
// bypass the toggle.
//
// Default for new installs: 'light'. Deliberate, opinionated default;
// matches the marketing site's primary appearance.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { Theme, type ThemeColors } from '@/constants/colors';

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
  const [pref, setPrefState] = useState<ThemePref>('light');
  const [resolved, setResolved] = useState<ResolvedTheme>('light');

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

  const colors: ThemeColors = useMemo(() => Theme[resolved], [resolved]);

  return useMemo(
    () => ({ pref, resolved, colors, setPref }),
    [pref, resolved, colors, setPref],
  );
});
