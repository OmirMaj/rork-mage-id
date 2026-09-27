/**
 * Smoke — the level renders OUTSIDE the ThemeProvider (lane CORE).
 *
 * BrandSplash mounts after </ThemeProvider></ThemeLoader> in app/_layout.tsx,
 * where useTheme() (createContextHook, no default) returns undefined. A
 * `const { colors } = useTheme()` there is a TypeError on every cold start.
 * This file deliberately does NOT mock '@/contexts/ThemeContext' and mounts no
 * ThemeProvider (loader-platform.test.tsx mocks it at module level, so it
 * could never catch this).
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import LevelMark from '@/components/loaders/LevelMark';
import BootShell from '@/components/loaders/BootShell';

const H = { includeHiddenElements: true } as const;

describe('the level with no ThemeProvider', () => {
  it('tone="splash" renders without throwing', () => {
    const r = render(<LevelMark tone="splash" size={168} revealDelayMs={0} exit="none" />);
    expect(r.getByTestId('level-mark', H)).toBeTruthy();
    r.unmount();
  });

  it('a token tone falls back to splashFallbackColors instead of crashing', () => {
    const r = render(<LevelMark size={36} />);
    expect(r.getByTestId('level-mark', H)).toBeTruthy();
    r.unmount();
  });

  it('BootShell renders without throwing', () => {
    const r = render(<BootShell />);
    expect(r.getByTestId('boot-shell')).toBeTruthy();
    expect(r.getByTestId('level-mark', H)).toBeTruthy();
    r.unmount();
  });
});
