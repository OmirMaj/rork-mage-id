// useThemedStyles — pattern for components to consume themed styles.
//
// Usage:
//   const styles = useThemedStyles(makeStyles);
//   const makeStyles = (t: ThemeColors) => StyleSheet.create({ ... });
//
// Memoized per resolved theme. Re-runs only when the theme changes.

import { useMemo } from 'react';
import type { StyleSheet } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';

type StyleFactory<T> = (theme: ThemeColors) => T;

export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: StyleFactory<T>,
): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}
