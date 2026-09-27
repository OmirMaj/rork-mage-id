/**
 * Wave 6d restore (d6r), lane K2 — Home with the ATTENTION dock open, at the
 * founder's 1512 × 945.
 *
 * The sidebar's Action Required row (lane K3) docks the attention list:
 * useShellDock().open(<DesktopActionRail variant="dock" />, { id:
 * ATTENTION_DOCK_ID, … }). Home must then treat the list as on screen
 * elsewhere (railShowing), exactly as it does for the 300 px rail — or it
 * would draw the same list twice (the dock AND the inline Brain Watch card).
 *
 *  1. The shell geometry (real ShellDock, real tabs layout, desktop web): no
 *     rail, the dock 440, the page 1512 − 240 − 440 = 832.
 *  2. The REAL Home (the real app/_layout, the fixture world, 1512): with the
 *     attention dock open, no inline Brain Watch; with an Ask dock open, Brain
 *     Watch is back inline (only the attention list replaces it); with the
 *     attention dock hidden (Cmd+J), back inline too.
 *
 * The dock is opened through the real useShellDock().open in both — in (2)
 * from a stand-in for the global BrainSurface overlay, which the root layout
 * mounts inside the same ShellDockProvider as the screens.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Slot } from 'expo-router';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { world } from '@/__tests__/fixtures/world';
import { ShellDockHost, ShellDockProvider, useShellDock, ATTENTION_DOCK_ID, ASK_DOCK_ID } from '@/components/desktop/ShellDock';
import DesktopActionRail from '@/components/DesktopActionRail';
import TabLayout from '@/app/(tabs)/_layout';
import { SIDE_PANEL_DEFAULT } from '@/utils/splitViewLayout';

// ── The layout gate: a width + a web flag, like the app's hook ─────────────
let mockWidth = 390;
let mockWeb = false;
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => {
    const isDesktop = mockWidth >= 1024 || (mockWeb && mockWidth >= 900);
    const isTablet = !isDesktop && mockWidth >= 768;
    return {
      screenSize: isDesktop ? 'desktop' : isTablet ? 'tablet' : 'phone',
      isPhone: !isDesktop && !isTablet,
      isTablet,
      isDesktop,
      width: mockWidth,
      height: 945,
      contentMaxWidth: isDesktop ? 1280 : isTablet ? 900 : mockWidth,
      sidebarWidth: isDesktop ? 240 : 0,
      showSidebar: isDesktop,
      ganttRowHeight: isDesktop ? 40 : isTablet ? 36 : 32,
    };
  },
}));

// Section 1 only: the persona and the attention count are forced; null = real.
let mockCore: { userRole: string; projects: never[] } | null = null;
jest.mock('@/contexts/ProjectContext', () => {
  const actual = jest.requireActual('@/contexts/ProjectContext');
  return {
    ...actual,
    useCoreData: () => (mockCore ? { userRole: mockCore.userRole, projects: mockCore.projects } : actual.useCoreData()),
  };
});
let mockBrain: { total: number; sourceFailed: boolean } | null = null;
jest.mock('@/hooks/useBrainWatch', () => {
  const actual = jest.requireActual('@/hooks/useBrainWatch');
  return {
    ...actual,
    useBrainWatch: () => (mockBrain
      ? { items: [], total: mockBrain.total, byKind: {}, sourceFailed: mockBrain.sourceFailed }
      : actual.useBrainWatch()),
  };
});

// DesktopActionRail: only WHERE it draws is under test (its list has its own
// suites). The stub carries its variant, and its real rail width, 300.
jest.mock('@/components/DesktopActionRail', () => {
  const R = jest.requireActual('react');
  const { View: V } = jest.requireActual('react-native');
  return {
    __esModule: true,
    RAIL_WIDTH: 300,
    default: ({ width = 300, variant = 'rail' }: { width?: number; variant?: 'rail' | 'dock' }) =>
      R.createElement(V, { testID: `desktop-action-rail-${variant}`, style: variant === 'dock' ? { flex: 1 } : { width } }),
  };
});

// Section 2: the global overlay layer (mounted by app/_layout inside the
// ShellDockProvider) opens the dock the test names, through the real API.
let mockDockOpen: null | { id: string; hide?: boolean } = null;
jest.mock('@/components/brain/BrainSurface', () => {
  const R = jest.requireActual('react');
  const { ShellDockAPI } = { ShellDockAPI: jest.requireActual('@/components/desktop/ShellDock') };
  const Rail = jest.requireMock('@/components/DesktopActionRail').default;
  function BrainSurface() {
    const dock = ShellDockAPI.useShellDock();
    const hid = R.useRef(false);
    // Every render, not once on mount: the root layout's ShellDockProvider
    // empties the dock when the signed-in user hydrates (its resetKey), so
    // the list is docked again whenever it finds the dock empty.
    R.useEffect(() => {
      if (!mockDockOpen) return;
      if (dock.content == null) {
        hid.current = false;
        dock.open(R.createElement(Rail, { variant: 'dock' }), { id: mockDockOpen.id, title: 'Action Required', width: 440 });
        return;
      }
      if (mockDockOpen.hide && !dock.hidden && !hid.current) { hid.current = true; dock.toggle(); }
    });
    return null;
  }
  return { __esModule: true, BrainSurface };
});

let mockFakeTheme = false;
jest.mock('@/contexts/ThemeContext', () => {
  const R = jest.requireActual('react');
  const actual = jest.requireActual('@/contexts/ThemeContext');
  const palette = jest.requireActual('@/constants/colors');
  const colors = { ...palette.Theme.light, ...palette.deriveAccentPalette(palette.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ...actual,
    ThemeProvider: ({ children }: { children: React.ReactNode }) =>
      mockFakeTheme ? R.createElement(R.Fragment, null, children) : R.createElement(actual.ThemeProvider, null, children),
    useTheme: () => (mockFakeTheme ? value : actual.useTheme()),
  };
});

let restoreOS: (() => void) | null = null;
function env(os: 'ios' | 'web', width: number, height = 945) {
  restoreOS?.();
  restoreOS = os === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', os).restore;
  mockWidth = width;
  mockWeb = os === 'web';
  Dimensions.set({
    window: { width, height, scale: 2, fontScale: 1 },
    screen: { width, height, scale: 2, fontScale: 1 },
  });
}
afterEach(() => {
  restoreOS?.();
  restoreOS = null;
  mockFakeTheme = false;
  mockCore = null;
  mockBrain = null;
  mockDockOpen = null;
  Dimensions.set({
    window: { width: 390, height: 844, scale: 3, fontScale: 1 },
    screen: { width: 390, height: 844, scale: 3, fontScale: 1 },
  });
});

const flat = (style: unknown): ViewStyle => StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {};

// ═══ 1. The shell geometry at 1512 desktop web ═══════════════════════════════

const WINDOW = 1512;
function OpenAttentionDock() {
  const dock = useShellDock();
  React.useEffect(() => {
    dock.open(<DesktopActionRail variant="dock" />, { id: ATTENTION_DOCK_ID, title: 'Action Required', width: SIDE_PANEL_DEFAULT });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
function ShellRoot() {
  return (
    <ShellDockProvider>
      <OpenAttentionDock />
      <View style={{ flexDirection: 'row', flex: 1 }}>
        <View testID="shell-sidebar" style={{ width: 240 }} />
        <View style={{ flex: 1 }}><Slot /></View>
        <ShellDockHost visible />
      </View>
    </ShellDockProvider>
  );
}
const Probe = () => <Text testID="probe">screen</Text>;
const TabStack = () => <Slot />;
const TAB_NAMES = ['(home)', 'summary', 'discover', 'settings', 'estimate', 'materials', 'schedule', 'marketplace', 'subs', 'equipment', 'mage-id-bids', 'construction-ai'];
const SHELL_TREE: Record<string, React.ComponentType> = {
  '_layout': ShellRoot,
  '(tabs)/_layout': TabLayout,
  ...Object.fromEntries(TAB_NAMES.flatMap((n) => [[`(tabs)/${n}/_layout`, TabStack], [`(tabs)/${n}/index`, Probe]])),
};

describe('d6r K2: Home with the attention dock at 1512 desktop web', () => {
  it('1512 Home with the attention dock: no rail, dock 440, page 832', async () => {
    env('web', WINDOW);
    mockFakeTheme = true;
    mockCore = { userRole: 'contractor', projects: [] };
    mockBrain = { total: 3, sourceFailed: false };
    const tree = renderRouter(SHELL_TREE, { initialUrl: '/' });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(tree.getByTestId('desktop-action-rail-dock')).toBeTruthy();
    expect(tree.queryByTestId('desktop-action-rail-rail')).toBeNull();
    const dockNode = tree.getByLabelText('Action Required');
    const dock = flat(dockNode.props.style).width as number;
    const sidebar = flat(tree.getByTestId('shell-sidebar').props.style).width as number;
    expect(dock).toBe(440);
    expect(flat(dockNode.props.style).position).not.toBe('absolute');
    expect(WINDOW - sidebar - dock).toBe(832);
  });
});

// ═══ 2. The real Home: the docked list replaces the inline Brain Watch ═══════

const BRAIN_WATCH_INLINE = /things? needs? your attention|All clear — nothing overdue|waiting on a reply|Couldn't reach MAGE — showing/;

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

/** Five more jobs beside the fixture's one (w6c-home's set). */
const MORE_PROJECTS = [
  { id: 'aaaaaaa1-0000-4000-8000-000000000001', name: 'Birch Street ADU', status: 'draft' },
  { id: 'aaaaaaa1-0000-4000-8000-000000000002', name: 'Cedar Court roof', status: 'estimated' },
  { id: 'aaaaaaa1-0000-4000-8000-000000000003', name: 'Dunmore bath', status: 'completed' },
  { id: 'aaaaaaa1-0000-4000-8000-000000000004', name: 'Elm deck rebuild', status: 'closed' },
  { id: 'aaaaaaa1-0000-4000-8000-000000000005', name: 'Fairview basement', status: 'in_progress' },
].map((p) => ({
  ...world.project,
  ...p,
  clientPortal: undefined,
  linkedEstimate: undefined,
  schedule: null,
}));
async function mountHome1512() {
  env('ios', WINDOW);
  await primeWorld('populated');
  await AsyncStorage.setItem('mageid_projects', JSON.stringify([world.project, ...MORE_PROJECTS]));
  const tree = await mountRouteChecked('/');
  await pump();
  return tree;
}

describe('d6r K2: the real Home at 1512 with a docked list', () => {
  jest.setTimeout(120000);

  it('1512 Home with the attention dock: no rail, no inline BrainWatchCard', async () => {
    mockDockOpen = { id: ATTENTION_DOCK_ID };
    await mountHome1512();
    expect(screen.getByTestId('portfolio-table')).toBeTruthy();
    expect(screen.queryByTestId('desktop-action-rail-rail')).toBeNull();
    expect(screen.queryAllByText(BRAIN_WATCH_INLINE)).toHaveLength(0);
  });

  it('1512 with the Ask dock open instead: no rail, Brain Watch back inline', async () => {
    mockDockOpen = { id: ASK_DOCK_ID };
    await mountHome1512();
    expect(screen.queryByTestId('desktop-action-rail-rail')).toBeNull();
    expect(screen.queryAllByText(BRAIN_WATCH_INLINE).length).toBeGreaterThan(0);
  });

  it('1512 with the attention dock hidden (Cmd+J): Brain Watch back inline', async () => {
    mockDockOpen = { id: ATTENTION_DOCK_ID, hide: true };
    await mountHome1512();
    expect(screen.queryByTestId('desktop-action-rail-rail')).toBeNull();
    expect(screen.queryAllByText(BRAIN_WATCH_INLINE).length).toBeGreaterThan(0);
  });
});
