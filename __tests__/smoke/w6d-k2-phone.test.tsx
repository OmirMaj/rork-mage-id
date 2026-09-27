/**
 * Wave 6d restore (d6r), lane K2 — GOLDEN PHONE SNAPSHOTS for UniversalSearch
 * at the two web widths below the 900 px desktop gate.
 *
 * Recorded FIRST, on the untouched base (24e74ecf), before a single K2 edit.
 * K2 turns Cmd+K into a desktop-web command palette: UniversalSearch returns
 * <CommandPalette /> when useIsDesktopWeb() is true, AFTER its last hook. At
 * web 390 and web 820 that gate is false, so the tree below must stay
 * byte-identical. (w6c-shell-phone already pins UniversalSearch at ios 390 and
 * CreateMenu at ios / web 390 / web 820.)
 *
 * Harness: the w6c-shell-phone one — react-test-renderer inside act, one
 * render per test, Platform.OS replaced per test, every prop copied (undefined
 * ones included) with styles flattened.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import UniversalSearch from '@/components/UniversalSearch';

type TestNode = { props: Record<string, unknown>; findAll(p: (n: TestNode) => boolean): TestNode[] };
type TestRendererInstance = { toJSON(): unknown; unmount(): void; root: TestNode };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer: { create(el: React.ReactElement): TestRendererInstance } = require('react-test-renderer');

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/contexts/ThemeContext');
  const palette = jest.requireActual('@/constants/colors');
  const colors = { ...palette.Theme.light, ...palette.deriveAccentPalette(palette.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ...actual, useTheme: () => value };
});

jest.mock('@/contexts/ProjectContext', () => {
  const actual = jest.requireActual('@/contexts/ProjectContext');
  return {
    ...actual,
    useCoreData: () => ({ userRole: 'contractor', projects: [] }),
    useProjects: () => ({ projects: [] }),
  };
});

const mockRouter = { push: () => {}, replace: () => {}, back: () => {}, navigate: () => {}, canGoBack: () => false };
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return { ...actual, useRouter: () => mockRouter };
});
jest.mock('@/hooks/useTierAccess', () => {
  const actual = jest.requireActual('@/hooks/useTierAccess');
  return {
    ...actual,
    useTierAccess: () => ({
      tier: 'pro', isProOrAbove: true, isBusinessOrAbove: false,
      canAccess: () => true, requiredTierFor: () => 'pro',
    }),
  };
});
jest.mock('@/contexts/SearchContext', () => {
  const actual = jest.requireActual('@/contexts/SearchContext');
  return {
    ...actual,
    useSearch: () => ({
      isOpen: true, openSearch: () => {}, closeSearch: () => {}, toggleSearch: () => {},
      voiceSignal: 0, helpSignal: 0, openVoice: () => {}, openHelp: () => {},
    }),
  };
});
jest.mock('@/hooks/useUniversalSearch', () => {
  const actual = jest.requireActual('@/hooks/useUniversalSearch');
  return { ...actual, useUniversalSearch: () => ({ grouped: {}, isSearching: false }) };
});
jest.mock('@/hooks/useEntityNavigation', () => {
  const actual = jest.requireActual('@/hooks/useEntityNavigation');
  return { ...actual, useEntityNavigation: () => ({ navigateTo: () => {} }) };
});

let restoreOS: (() => void) | null = null;
function as(os: typeof Platform.OS, width: number, height = 844) {
  restoreOS?.();
  restoreOS = os === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', os).restore;
  Dimensions.set({
    window: { width, height, scale: 3, fontScale: 1 },
    screen: { width, height, scale: 3, fontScale: 1 },
  });
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => {
  restoreOS?.();
  restoreOS = null;
  Dimensions.set({
    window: { width: 390, height: 844, scale: 3, fontScale: 1 },
    screen: { width: 390, height: 844, scale: 3, fontScale: 1 },
  });
});

const flat = (style: unknown): ViewStyle => StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {};

function phoneView(node: unknown): unknown {
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(phoneView);
  const el = node as { type: string; props: Record<string, unknown>; children: unknown };
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(el.props ?? {})) {
    if (k === 'screenId') continue;
    props[k] = /style$/i.test(k) && v != null && typeof v === 'object' ? flat(v) : v;
  }
  return { type: el.type, props, children: phoneView(el.children) };
}

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function search(query: string | null): unknown {
  let r: TestRendererInstance | null = null;
  act(() => {
    r = TestRenderer.create(<SafeAreaProvider initialMetrics={METRICS}><UniversalSearch /></SafeAreaProvider>);
  });
  const inst = r as unknown as TestRendererInstance;
  if (query) {
    act(() => {
      const input = inst.root.findAll((n) => typeof n.props.onChangeText === 'function')[0];
      (input.props.onChangeText as (s: string) => void)(query);
    });
  }
  act(() => { jest.advanceTimersByTime(1000); });
  const json = inst.toJSON();
  act(() => { inst.unmount(); });
  return phoneView(json);
}

describe('UniversalSearch below the desktop gate (web)', () => {
  it('open, empty query, web 390', () => { as('web', 390); expect(search(null)).toMatchSnapshot(); });
  it('open, "gantt", web 390', () => { as('web', 390); expect(search('gantt')).toMatchSnapshot(); });
  it('open, empty query, web 820', () => { as('web', 820, 1180); expect(search(null)).toMatchSnapshot(); });
  it('open, "gantt", web 820', () => { as('web', 820, 1180); expect(search('gantt')).toMatchSnapshot(); });
});
