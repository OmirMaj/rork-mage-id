/**
 * Wave 6b, lane L1 — the desktop page frame, the shell dock and the themed
 * native header, proven at BOTH widths.
 *
 * The rule the wave is built on: PHONE IDENTICAL. Every desktop rule switches
 * on only behind useResponsiveLayout().isDesktop (web ≥ 900 CSS px); on a phone
 * the component renders today's exact tree. Two kinds of proof here:
 *
 *  1. Unit renders of the new primitives with the responsive hook and
 *     Platform.OS forced to phone / desktop web: on native the frame adds no
 *     host View; on desktop the column is capped at Layout.page[kind].
 *
 *  2. Real routes mounted inside the REAL app/_layout.tsx at 390 pt on native,
 *     compared against snapshots RECORDED FROM THE PRE-WAVE-6b FILES (commit
 *     6065b326 — the files were swapped back, the snapshots written, and the
 *     wave's files restored byte-identical). A diff in any of them means a
 *     phone user would see a change. The dark-mode header assertions are the
 *     one deliberate phone change: black-on-dark titles become readable.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, within } from '@testing-library/react-native';
import { mountRouteChecked, primeSignedOut, primeWorld, type MountResult } from '@/__tests__/helpers/mountRoute';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { Theme } from '@/constants/colors';
import { Layout } from '@/constants/designTokens';
import { DesktopPageFrame } from '@/components/desktop/DesktopPageFrame';
import { ShellDockHost, ShellDockProvider, useShellDock } from '@/components/desktop/ShellDock';
import { clampSidePanelWidth } from '@/utils/splitViewLayout';
import { ROUTE_PAGE_TYPE } from '@/utils/desktopPage';

// ── Forcing the responsive hook and the platform ──────────────────────────
// `mock`-prefixed so jest's hoisted factory may read it. null = the real hook.
let mockForcedLayout: null | 'phone' | 'desktop' | 'laptop1366' = null;
jest.mock('@/utils/useResponsiveLayout', () => {
  const actual = jest.requireActual('@/utils/useResponsiveLayout');
  return {
    ...actual,
    useResponsiveLayout: () => {
      const real = actual.useResponsiveLayout();
      if (mockForcedLayout === 'desktop') {
        return {
          ...real, screenSize: 'desktop', isPhone: false, isTablet: false, isDesktop: true,
          width: 1512, height: 945, contentMaxWidth: 1280, sidebarWidth: 240, showSidebar: true,
        };
      }
      if (mockForcedLayout === 'laptop1366') {
        return {
          ...real, screenSize: 'desktop', isPhone: false, isTablet: false, isDesktop: true,
          width: 1366, height: 768, contentMaxWidth: 1280, sidebarWidth: 240, showSidebar: true,
        };
      }
      if (mockForcedLayout === 'phone') {
        return {
          ...real, screenSize: 'phone', isPhone: true, isTablet: false, isDesktop: false,
          width: 390, height: 844, contentMaxWidth: 390, sidebarWidth: 0, showSidebar: false,
        };
      }
      return real;
    },
  };
});

// The unit renders (sections 1–2) use the real light palette WITHOUT
// ThemeProvider's AsyncStorage hydrate: that async setState lands between
// back-to-back renders and trips "overlapping act() calls" (the same reason
// ui-desktop-primitives.test.tsx fakes it). The real-route mounts (sections
// 3–4) need the REAL provider — dark mode is hydrated from storage — so the
// fake is switched on per test, never for a mounted app.
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

// Platform.OS is replaced per test and restored after it (jest.replaceProperty,
// not restoreAllMocks — that also strips the preset's Appearance mock).
let restoreOS: (() => void) | null = null;

function as(os: typeof Platform.OS, layout: 'phone' | 'desktop' | 'laptop1366') {
  restoreOS?.();
  restoreOS = os === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', os).restore;
  mockForcedLayout = layout;
}

afterEach(() => {
  restoreOS?.();
  restoreOS = null;
  mockForcedLayout = null;
  mockFakeTheme = false;
});

// 390 × 844 — an iPhone 15 — for every real-route mount below.
beforeAll(() => {
  Dimensions.set({
    window: { width: 390, height: 844, scale: 3, fontScale: 1 },
    screen: { width: 390, height: 844, scale: 3, fontScale: 1 },
  });
});

/** Flatten any style prop to one plain object. */
const flat = (style: unknown): ViewStyle => StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {};

const Probe = () => <Text testID="probe">screen</Text>;

// ONE render per test. Measured in this harness (RNTL 13 + React 19, with
// after-env's manual cleanup): a test that renders twice leaves the act queue
// open, and every render in the NEXT test comes back unmounted. So each test
// below mounts a single tree — the 170-route equality check renders all 170
// frames side by side in one tree.
const PROBE_JSON = { type: 'Text', props: { testID: 'probe' }, children: ['screen'] };

// ═══ 1. DesktopPageFrame ═══════════════════════════════════════════════════

describe('DesktopPageFrame', () => {
  beforeEach(() => { mockFakeTheme = true; });

  it('on a native phone adds nothing: every mapped route renders the bare screen', () => {
    as('ios', 'phone');
    const routes = Object.keys(ROUTE_PAGE_TYPE);
    const tree = render(
      <ThemeProvider>
        {routes.map((r) => <DesktopPageFrame key={r} route={r}><Probe /></DesktopPageFrame>)}
      </ThemeProvider>,
    );
    const json = tree.toJSON() as unknown[];
    expect(json).toHaveLength(routes.length);
    for (const node of json) expect(node).toEqual(PROBE_JSON);
  });

  it('on native adds nothing even at a desktop-sized window', () => {
    as('ios', 'desktop');
    const tree = render(<ThemeProvider><DesktopPageFrame route="rfi"><Probe /></DesktopPageFrame></ThemeProvider>);
    expect(tree.toJSON()).toEqual(PROBE_JSON);
  });

  it('on desktop web caps a form route at Layout.page.form, centred on the page ground', () => {
    as('web', 'desktop');
    const tree = render(<ThemeProvider><DesktopPageFrame route="rfi"><Probe /></DesktopPageFrame></ThemeProvider>);
    const outer = tree.getByTestId('desktop-page-frame');
    const outerStyle = StyleSheet.flatten(outer.props.style);
    expect(outerStyle).toMatchObject({ flex: 1, alignItems: 'center' });
    expect(typeof outerStyle.backgroundColor).toBe('string');
    const inner = outer.children[0] as unknown as { props: { style: unknown } };
    expect(flat(inner.props.style)).toEqual({ flex: 1, width: '100%', maxWidth: Layout.page.form });
    expect(tree.getByTestId('probe')).toBeTruthy();
  });

  it('on desktop web uses the route map for each kind', () => {
    as('web', 'desktop');
    const cases: [string, number | null][] = [
      ['wip-report', Layout.page.table],
      ['construction-news', Layout.page.dashboard],
      ['copilot-hub', Layout.page.form],
      ['safety-jha', Layout.page.dashboard],
      // Pass-through: bleed tools, self-capped screens and the tab navigator.
      ['schedule-pro', null],
      ['project-detail', null],
      ['(tabs)', null],
    ];
    const tree = render(
      <ThemeProvider>
        {cases.map(([r]) => (
          <View key={r} testID={`case-${r}`}><DesktopPageFrame route={r}><Probe /></DesktopPageFrame></View>
        ))}
      </ThemeProvider>,
    );
    for (const [r, width] of cases) {
      const holder = within(tree.getByTestId(`case-${r}`));
      const outer = holder.queryByTestId('desktop-page-frame');
      if (width === null) {
        expect(outer).toBeNull();
        expect(holder.getByTestId('probe')).toBeTruthy();
      } else {
        const inner = outer!.children[0] as unknown as { props: { style: unknown } };
        expect(flat(inner.props.style).maxWidth).toBe(width);
      }
    }
  });

  it('on web below desktop keeps the same two Views, both plain flex:1 (no remount at 900 px)', () => {
    as('web', 'phone');
    const tree = render(<ThemeProvider><DesktopPageFrame route="rfi"><Probe /></DesktopPageFrame></ThemeProvider>);
    const outer = tree.getByTestId('desktop-page-frame');
    expect(StyleSheet.flatten(outer.props.style)).toEqual({ flex: 1 });
    const inner = outer.children[0] as unknown as { props: { style: unknown } };
    expect(flat(inner.props.style)).toEqual({ flex: 1 });
  });
});

// ═══ 2. ShellDock ═══════════════════════════════════════════════════════════

function DockOpener({ node, width }: { node: React.ReactNode; width?: number }) {
  const dock = useShellDock();
  React.useEffect(() => { dock.open(node, { title: 'Ask MAGE', width }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function dockTree(resetKey: string | null, width?: number) {
  return (
    <ThemeProvider>
      <ShellDockProvider resetKey={resetKey}>
        <View>
          <DockOpener node={<Text testID="docked">docked</Text>} width={width} />
          <ShellDockHost />
        </View>
      </ShellDockProvider>
    </ThemeProvider>
  );
}

describe('ShellDock', () => {
  beforeEach(() => { mockFakeTheme = true; });
  it('renders nothing on a phone, even with content docked', () => {
    as('ios', 'phone');
    const tree = render(dockTree('u1'));
    expect(tree.queryByTestId('docked')).toBeNull();
  });

  it('on desktop web opens a 440 px right-hand slot with a close button', () => {
    as('web', 'desktop');
    const tree = render(dockTree('u1'));
    expect(tree.getByTestId('docked')).toBeTruthy();
    const dock = tree.getByLabelText('Ask MAGE');
    expect(StyleSheet.flatten(dock.props.style).width).toBe(440);
    // The dock is SidePanel (one right-panel implementation): its close button
    // is labelled after the docked title.
    fireEvent.press(tree.getByLabelText('Close Ask MAGE'));
    expect(tree.queryByTestId('docked')).toBeNull();
  });

  it('closes on a tenant switch (resetKey change)', () => {
    as('web', 'desktop');
    const tree = render(dockTree('u1'));
    expect(tree.getByTestId('docked')).toBeTruthy();
    tree.rerender(
      <ThemeProvider>
        <ShellDockProvider resetKey="u2">
          <View><ShellDockHost /></View>
        </ShellDockProvider>
      </ThemeProvider>,
    );
    expect(tree.queryByTestId('docked')).toBeNull();
  });

  it('docks beside the page on the 1512 MacBook (1272 px column): no overlay', () => {
    as('web', 'desktop');
    const tree = render(dockTree('u1'));
    expect(flat(tree.getByLabelText('Ask MAGE').props.style).position).not.toBe('absolute');
  });

  it('OVERLAYS the page on a 1366 laptop (1126 px column) instead of squeezing it to 686', () => {
    as('web', 'laptop1366');
    const tree = render(dockTree('u1'));
    const style = flat(tree.getByLabelText('Ask MAGE').props.style);
    expect(style.position).toBe('absolute');
    expect(style.right).toBe(0);
    expect(style.width).toBe(440);
  });

  it('a requested width is clamped into 360–560 by the SidePanel width source', () => {
    as('web', 'desktop');
    const tree = render(dockTree('u1', 900));
    expect(flat(tree.getByLabelText('Ask MAGE').props.style).width).toBe(560);
    expect(clampSidePanelWidth(Number.NaN)).toBe(440);
    expect(clampSidePanelWidth(100)).toBe(360);
    expect(clampSidePanelWidth(500)).toBe(500);
  });
});

// ═══ 3. Phone equality — real routes, real layout, 390 native ═════════════

type Json = ReturnType<MountResult['toJSON']>;

/** The native header config + the screen container of every mounted screen. */
function chrome(node: Json): unknown[] {
  const out: unknown[] = [];
  const visit = (n: unknown) => {
    if (!n || typeof n === 'string') return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    const el = n as { type: string; props: Record<string, unknown>; children: unknown };
    if (el.type === 'RNSScreenStackHeaderConfig') {
      const { children: _c, ...props } = el.props;
      out.push({ header: props });
    }
    if (el.type === 'RNSScreen') out.push({ screenStyle: flat(el.props.style) });
    visit(el.children);
  };
  visit(node);
  return out;
}

/**
 * What a phone user sees, and nothing else: every style prop FLATTENED (a
 * `false` left in a style array by `isDesktop && …` renders nothing — the
 * spec's rule is that the flattened style equals today's), and the
 * per-mount random `screenId` react-native-screens stamps on every screen
 * removed (it differs between two mounts of the SAME code).
 */
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

/**
 * Wall-clock text removed from a tree, so a full-tree snapshot stays stable
 * across days and time zones. Settings prints the AI-cap reset times ("Daily AI
 * resets at 8:00 PM · Takeoff pages reset Sep 30, 8:00 PM"), which move with
 * the clock and the machine's zone and say nothing about the layout.
 */
const CLOCK_TEXT = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, |\b\d{1,2}:\d{2} ?(?:AM|PM)\b/g;
// Settings' AI-reset sentence changes SHAPE, not just its clock, with the
// zone and the hour (nextAiResetLabel): "at midnight" / "Oct 1" in a
// UTC-aligned zone such as the CI runner, "tomorrow at 8:00 PM" once the local
// reset hour has passed. Swapping only the clock left those variants in the
// snapshot, so the whole sentence collapses to one fixed token first.
const AI_RESET_SENTENCE = /Daily AI resets .*? · Takeoff pages reset .*/g;
function clockFree(node: unknown): unknown {
  if (typeof node === 'string') {
    return node
      .replace(AI_RESET_SENTENCE, 'Daily AI resets <reset> · Takeoff pages reset <reset>')
      .replace(CLOCK_TEXT, '<clock>');
  }
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(clockFree);
  const el = node as { type: string; props: Record<string, unknown>; children: unknown };
  return { ...el, children: clockFree(el.children) };
}

describe('phone equality at 390 native (snapshots recorded from 6065b326)', () => {
  it.each(['/signup', '/reset-password', '/accept-invite'])('%s renders exactly as before', async (href) => {
    as('ios', 'phone');
    await primeSignedOut();
    const tree = await mountRouteChecked(href);
    expect(tree.getPathname()).toBe(href);
    expect(phoneView(tree.toJSON())).toMatchSnapshot();
  });

  it.each(['/invoice', '/sub-portal-setup', '/leads', '/rfi', '/safety'])(
    '%s keeps the same light-mode native header and screen ground',
    async (href) => {
      as('ios', 'phone');
      await primeWorld('empty');
      await AsyncStorage.setItem('mageid_theme', 'light');
      const tree = await mountRouteChecked(href);
      expect(tree.getPathname()).toBe(href);
      const c = chrome(tree.toJSON());
      expect(c.length).toBeGreaterThan(0);
      expect(c).toMatchSnapshot();
    },
  );

  // The FULL flattened tree of a signed-in stack route and a signed-in tab
  // route — not just the header config. Signed-in is where the shell's
  // globals mount (the offline sync pill, the dock provider, the frame), so a
  // stray native prop there (the review caught `nativeID="mage-sync-pill"`
  // leaking onto iOS) shows up here and nowhere in the header-only checks.
  it.each(['/rfi', '/settings'])('%s (signed in) renders the exact same full tree as before', async (href) => {
    as('ios', 'phone');
    await primeWorld('empty');
    await AsyncStorage.setItem('mageid_theme', 'light');
    const tree = await mountRouteChecked(href);
    expect(tree.getPathname()).toBe(href);
    expect(clockFree(phoneView(tree.toJSON()))).toMatchSnapshot();
  });

  it('/settings tab renders exactly as before (tab navigator, phone branch)', async () => {
    as('ios', 'phone');
    await primeWorld('empty');
    await AsyncStorage.setItem('mageid_theme', 'light');
    const tree = await mountRouteChecked('/settings');
    expect(chrome(tree.toJSON())).toMatchSnapshot();
  });
});

// ═══ 4. The one deliberate phone change: dark-mode headers ═════════════════

describe('dark-mode native headers follow the theme', () => {
  it.each(['/invoice', '/rfi'])('%s: dark bar, light title (was black on dark)', async (href) => {
    as('ios', 'phone');
    await primeWorld('empty');
    await AsyncStorage.setItem('mageid_theme', 'dark');
    const tree = await mountRouteChecked(href);
    const header = (chrome(tree.toJSON()).find((x) => 'header' in (x as object)) as { header: Record<string, unknown> }).header;
    expect(header.backgroundColor).toBe(Theme.dark.bg);
    expect(header.titleColor).toBe(Theme.dark.text);
  });

  it('/leads (navigator-theme header): dark bar and ink, not the white default', async () => {
    as('ios', 'phone');
    await primeWorld('empty');
    await AsyncStorage.setItem('mageid_theme', 'dark');
    const tree = await mountRouteChecked('/leads');
    const header = (chrome(tree.toJSON()).find((x) => 'header' in (x as object)) as { header: Record<string, unknown> }).header;
    expect(header.backgroundColor).toBe(Theme.dark.bg);
    expect(header.titleColor).toBe(Theme.dark.text);
  });
});
