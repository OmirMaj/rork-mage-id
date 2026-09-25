/**
 * Wave 6c, lane S — GOLDEN PHONE SNAPSHOTS for every shell surface the lane
 * touches.
 *
 * Recorded FIRST, on the untouched base (77c00f3d), before a single lane-S
 * edit. The lane then rewires the sidebar, the tab layout's action rail and
 * badge, the dialog-scope hotkeys of AlertHost / UniversalSearch / Sheet,
 * useSheetFrame's result shape and CreateMenu's routing — all of it desktop or
 * desktop-web only by construction. This file is the proof that a phone does
 * not see any of it: every snapshot below must stay byte-identical, EXCEPT the
 * two the spec names as deliberate phone deltas (regenerated in their own
 * step, with the diff reviewed):
 *
 *   - TabLayout, property_manager: the Home tab loses its attention badge and
 *     the ", couldn't reach MAGE" a11y suffix (a PM has no GC attention feed);
 *   - Settings, property_manager: ESTIMATE DEFAULTS, PDF NAMING, YOUR COSTS
 *     and SUPPLIER MARKETPLACE are gone (contractor-only settings).
 *
 * Harness: react-test-renderer inside act (the RNTL overlapping-act gotcha —
 * one render per test), Platform.OS replaced per test, 390 x 844 unless the
 * test is one of the web-width repeats (web 390, web 820 — both below the
 * 900 px desktop gate, so they must equal today's tree too).
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, Text, View, Modal, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import TabLayout from '@/app/(tabs)/_layout';
import { CreateMenu } from '@/components/CreateMenu';
import UniversalSearch from '@/components/UniversalSearch';
import AlertHost from '@/components/AlertHost';
import { useSheetFrame } from '@/components/ui/Sheet';
import { showAlert } from '@/utils/alert';

// react-test-renderer ships no .d.ts here (RNTL wraps it); only the calls this
// file makes are typed.
type TestNode = { props: Record<string, unknown>; findAll(p: (n: TestNode) => boolean): TestNode[] };
type TestRendererInstance = { toJSON(): unknown; unmount(): void; root: TestNode };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer: { create(el: React.ReactElement): TestRendererInstance } = require('react-test-renderer');

// ── Switchable mocks ───────────────────────────────────────────────────────
// `mock`-prefixed so jest's hoisted factories may read them. null = the real
// module, which is what the real-app mounts (Settings) use.

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

type MockCore = { userRole: string | null; projects: { id: string; name: string; status: string }[] };
let mockCore: MockCore | null = null;
jest.mock('@/contexts/ProjectContext', () => {
  const actual = jest.requireActual('@/contexts/ProjectContext');
  return {
    ...actual,
    useCoreData: () => (mockCore ? { userRole: mockCore.userRole, projects: mockCore.projects } : actual.useCoreData()),
    useProjects: () => (mockCore ? { projects: mockCore.projects } : actual.useProjects()),
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

let mockIsolated = false;
const mockRouter = { push: () => {}, replace: () => {}, back: () => {}, navigate: () => {}, canGoBack: () => false };
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return { ...actual, useRouter: () => (mockIsolated ? mockRouter : actual.useRouter()) };
});
jest.mock('@/hooks/useTierAccess', () => {
  const actual = jest.requireActual('@/hooks/useTierAccess');
  return {
    ...actual,
    useTierAccess: () => (mockIsolated
      ? {
          tier: 'pro', isProOrAbove: true, isBusinessOrAbove: false,
          canAccess: () => true, requiredTierFor: () => 'pro',
        }
      : actual.useTierAccess()),
  };
});
let mockSearchOpen = false;
jest.mock('@/contexts/SearchContext', () => {
  const actual = jest.requireActual('@/contexts/SearchContext');
  return {
    ...actual,
    useSearch: () => (mockIsolated
      ? {
          isOpen: mockSearchOpen, openSearch: () => {}, closeSearch: () => {}, toggleSearch: () => {},
          voiceSignal: 0, helpSignal: 0, openVoice: () => {}, openHelp: () => {},
        }
      : actual.useSearch()),
  };
});
jest.mock('@/hooks/useUniversalSearch', () => {
  const actual = jest.requireActual('@/hooks/useUniversalSearch');
  return {
    ...actual,
    useUniversalSearch: (q: string) => (mockIsolated ? { grouped: {}, isSearching: false } : actual.useUniversalSearch(q)),
  };
});
jest.mock('@/hooks/useEntityNavigation', () => {
  const actual = jest.requireActual('@/hooks/useEntityNavigation');
  return {
    ...actual,
    useEntityNavigation: () => (mockIsolated ? { navigateTo: () => {} } : actual.useEntityNavigation()),
  };
});

// ── Platform + window ──────────────────────────────────────────────────────

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
  mockFakeTheme = false;
  mockCore = null;
  mockBrain = null;
  mockIsolated = false;
  mockSearchOpen = false;
  Dimensions.set({
    window: { width: 390, height: 844, scale: 3, fontScale: 1 },
    screen: { width: 390, height: 844, scale: 3, fontScale: 1 },
  });
});

// ── Tree normalisation (copied from desktop-page-frame.test.tsx) ──────────

const flat = (style: unknown): ViewStyle => StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {};

/** Styles flattened (a `false` left by `isDesktop && …` renders nothing), the
 *  per-mount random screenId removed. */
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

const CLOCK_TEXT = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, |\b\d{1,2}:\d{2} ?(?:AM|PM)\b/g;
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

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** Mount through react-test-renderer in act, run `interact`, read, unmount. */
function isolated(el: React.ReactElement, interact?: (root: TestNode) => void): unknown {
  let r: TestRendererInstance | null = null;
  act(() => {
    r = TestRenderer.create(<SafeAreaProvider initialMetrics={METRICS}>{el}</SafeAreaProvider>);
  });
  const inst = r as unknown as TestRendererInstance;
  if (interact) act(() => { interact(inst.root); });
  act(() => { jest.advanceTimersByTime(1000); });
  const json = inst.toJSON();
  act(() => { inst.unmount(); });
  return phoneView(json);
}

// ═══ 1. TabLayout (the phone tab bar) ══════════════════════════════════════
// The real app/(tabs)/_layout.tsx inside a router whose screens are probes —
// the tab bar, its badge, its a11y labels and the icons are what is pinned.

const Probe = () => <Text testID="probe">screen</Text>;
const TabStack = () => <Slot />;
const TAB_NAMES = [
  '(home)', 'summary', 'discover', 'settings', 'estimate', 'materials', 'schedule',
  'marketplace', 'subs', 'equipment', 'mage-id-bids', 'construction-ai',
];
// Every tab is a directory with its own _layout in app/(tabs), like the app.
const TAB_TREE: Record<string, React.ComponentType> = {
  '(tabs)/_layout': TabLayout,
  ...Object.fromEntries(TAB_NAMES.flatMap((n) => [
    [`(tabs)/${n}/_layout`, TabStack],
    [`(tabs)/${n}/index`, Probe],
  ])),
};

async function tabLayoutTree(): Promise<unknown> {
  mockFakeTheme = true;
  const tree = renderRouter(TAB_TREE, { initialUrl: '/' });
  await act(async () => {
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
  });
  return phoneView(tree.toJSON());
}

describe('TabLayout on a phone', () => {
  it('contractor, 390 ios (badge "!" + the couldn\'t-reach suffix)', async () => {
    as('ios', 390);
    mockCore = { userRole: 'contractor', projects: [] };
    mockBrain = { total: 5, sourceFailed: true };
    expect(await tabLayoutTree()).toMatchSnapshot();
  });

  it('property_manager, 390 ios', async () => {
    as('ios', 390);
    mockCore = { userRole: 'property_manager', projects: [] };
    mockBrain = { total: 5, sourceFailed: true };
    expect(await tabLayoutTree()).toMatchSnapshot();
  });

  it('client, 390 ios (keeps today\'s badge)', async () => {
    as('ios', 390);
    mockCore = { userRole: 'client', projects: [] };
    mockBrain = { total: 5, sourceFailed: false };
    expect(await tabLayoutTree()).toMatchSnapshot();
  });

  it('contractor, web 390 (badge "99+")', async () => {
    as('web', 390);
    mockCore = { userRole: 'contractor', projects: [] };
    mockBrain = { total: 150, sourceFailed: false };
    expect(await tabLayoutTree()).toMatchSnapshot();
  });

  it('contractor, web 820 (tablet width, below the 900 desktop gate; badge "5")', async () => {
    as('web', 820, 1180);
    mockCore = { userRole: 'contractor', projects: [] };
    mockBrain = { total: 5, sourceFailed: false };
    expect(await tabLayoutTree()).toMatchSnapshot();
  });
});

// ═══ 2. Settings tab — the real app, both personas ═════════════════════════

describe('Settings tab on a phone (real app, 390 ios)', () => {
  it.each(['contractor', 'property_manager'])('%s', async (role) => {
    as('ios', 390);
    await primeWorld('empty');
    await AsyncStorage.setItem('mageid_theme', 'light');
    await AsyncStorage.setItem('mageid_user_role', role);
    const tree = await mountRouteChecked('/settings');
    expect(tree.getPathname()).toBe('/settings');
    expect(clockFree(phoneView(tree.toJSON()))).toMatchSnapshot();
  });
});

// ═══ 3. CreateMenu ═════════════════════════════════════════════════════════

const TWO_JOBS = [
  { id: 'p1', name: 'Henderson Remodel', status: 'in_progress' },
  { id: 'p2', name: 'Oak St Addition', status: 'estimated' },
];

function createMenu(pick: boolean): unknown {
  mockFakeTheme = true;
  mockIsolated = true;
  mockCore = { userRole: 'contractor', projects: TWO_JOBS };
  return isolated(
    <CreateMenu visible onClose={() => {}} />,
    pick
      ? (root) => {
          const rfi = root.findAll((n) => n.props.testID === 'create-rfi' && typeof n.props.onPress === 'function')[0];
          (rfi.props.onPress as () => void)();
        }
      : undefined,
  );
}

describe('CreateMenu on a phone', () => {
  it('list mode, 390 ios', () => { as('ios', 390); expect(createMenu(false)).toMatchSnapshot(); });
  it('picker mode, 390 ios', () => { as('ios', 390); expect(createMenu(true)).toMatchSnapshot(); });
  it('list mode, web 390', () => { as('web', 390); expect(createMenu(false)).toMatchSnapshot(); });
  it('picker mode, web 390', () => { as('web', 390); expect(createMenu(true)).toMatchSnapshot(); });
  it('list mode, web 820', () => { as('web', 820, 1180); expect(createMenu(false)).toMatchSnapshot(); });
  it('picker mode, web 820', () => { as('web', 820, 1180); expect(createMenu(true)).toMatchSnapshot(); });
});

// ═══ 4. UniversalSearch open ═══════════════════════════════════════════════

function search(query: string | null): unknown {
  mockFakeTheme = true;
  mockIsolated = true;
  mockSearchOpen = true;
  mockCore = { userRole: 'contractor', projects: [] };
  return isolated(
    <UniversalSearch />,
    query
      ? (root) => {
          const input = root.findAll((n) => typeof n.props.onChangeText === 'function')[0];
          (input.props.onChangeText as (s: string) => void)(query);
        }
      : undefined,
  );
}

describe('UniversalSearch on a phone', () => {
  it('open, empty query, 390 ios', () => { as('ios', 390); expect(search(null)).toMatchSnapshot(); });
  it('open, "gantt", 390 ios', () => { as('ios', 390); expect(search('gantt')).toMatchSnapshot(); });
});

// ═══ 5. AlertHost — a two-button confirm ══════════════════════════════════

describe('AlertHost on a phone', () => {
  it('a two-button confirm, 390 ios', () => {
    // showAlert only queues on web (native uses the real Alert). Queue it with
    // the platform set to web, then mount the host on ios: registerAlertHost
    // replays the pending request into the host.
    as('web', 390);
    showAlert('Delete this RFI?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {} },
    ]);
    as('ios', 390);
    mockFakeTheme = true;
    expect(isolated(<AlertHost />)).toMatchSnapshot();
  });
});

// ═══ 6. A hand-rolled useSheetFrame sheet ═════════════════════════════════
// The canonical adoption (components/ui/Sheet.tsx header): frame styles
// appended after the phone style, the handle behind showHandle, the Modal's
// own animationType through the frame.

function HandRolledSheet() {
  const f = useSheetFrame('form', { visible: true, animationType: 'slide' });
  return (
    <Modal visible transparent animationType={f.animationType} onRequestClose={() => {}}>
      <Pressable style={[sheetStyles.overlay, f.overlay]} onPress={() => {}} accessibilityRole="button" accessibilityLabel="Close">
        <View style={[sheetStyles.card, f.card]}>
          {f.showHandle && <View style={sheetStyles.handle} />}
          <Text>Edit task</Text>
          <View style={[sheetStyles.actions, f.footer]}>
            <Pressable style={[sheetStyles.btn, f.footerButton]} onPress={() => {}} accessibilityRole="button">
              <Text>Save</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}
const sheetStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  card: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40, position: 'absolute', bottom: 0, left: 0, right: 0 },
  handle: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center' },
  actions: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, height: 48 },
});

describe('a hand-rolled useSheetFrame sheet on a phone', () => {
  it('390 ios', () => {
    as('ios', 390);
    mockFakeTheme = true;
    expect(isolated(<HandRolledSheet />)).toMatchSnapshot();
  });
});
