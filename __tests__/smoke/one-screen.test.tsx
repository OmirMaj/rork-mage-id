/**
 * Stage 1 — the harness itself, proven on exactly one screen.
 *
 * This file exists so that when the every-route suite next door goes red, there
 * is a single unambiguous answer to "is the harness broken, or is the app
 * broken?". If this file is green, the harness works: babel transforms the
 * app's TS/JSX, jest-expo supplies the native surface, expo-router builds a
 * real in-memory navigator, and RNTL renders the tree.
 *
 * It stays in the suite permanently for that reason. It is the control.
 *
 * Deliberately NOT the full 16-provider stack — that is Stage 2, in
 * every-route.test.tsx. The screen chosen here (`(tabs)/settings/appearance`)
 * needs one real provider and nothing else, so a failure HERE is about jest,
 * and a failure THERE is about the app.
 */

import React from 'react';
import { renderRouter } from 'expo-router/testing-library';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import Appearance from '@/app/(tabs)/settings/appearance';

// react-native-safe-area-context has no native frame metrics off-device;
// without `initialMetrics` useSafeAreaInsets() returns undefined and every
// consumer of it dereferences undefined.
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider>{children}</ThemeProvider>
    </SafeAreaProvider>
  );
}

describe('smoke harness control', () => {
  it('mounts a real app screen without throwing', () => {
    // An in-memory route map, not the real app/ directory: this test is about
    // the harness, so it deliberately avoids anything that could fail for an
    // app reason.
    const tree = renderRouter(
      { index: Appearance as () => React.ReactElement },
      { initialUrl: '/', wrapper: Wrapper }
    );

    // Not a content assertion (explicitly out of scope per the spec) — just
    // proof that something rendered, rather than an empty tree quietly
    // "passing".
    expect(tree.toJSON()).not.toBeNull();
    expect(tree.getPathname()).toBe('/');
  });
});
