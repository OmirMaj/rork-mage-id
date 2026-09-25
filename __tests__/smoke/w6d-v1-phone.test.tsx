/**
 * Wave 6d, lane V1 — PHONE PROOF for the Esc / dialog-scope fixes.
 *
 * Lane V1 edits three components a phone renders:
 *   • DatePickerModal gains useSheetDialogScope(visible) (the C2 fix: an Esc on
 *     the picker opened inside Schedule Pro's pane closed the whole pane);
 *   • VoiceCaptureModal takes the R-PANEL reframe (useSheetFrame('panel') —
 *     it also registers the dialog scope — SheetOverlay + SheetScrim + the
 *     frame's card), which turns the opaque full-window voice sheet into the
 *     880 px right panel on DESKTOP;
 *   • SidePanel gains a DOM id on every desktop panel, `resizable`, and the one
 *     Esc rule for every scope — all on the desktop return.
 * On the iPhone none of that may change a pixel: useHotkeys registers nothing
 * off desktop web, the panel frame is all-null on a phone, SheetOverlay is a
 * Fragment there and SheetScrim is null, and SidePanel's phone branch is the
 * pageSheet Modal. This file is the proof.
 *
 * GOLDEN — recorded FIRST, on a pristine copy of the base (c1086c0c), before a
 * line of this lane was written, and never regenerated (run with --ci).
 *
 * What a snapshot records (the w6c-field-phone harness): every style FLATTENED,
 * handler props dropped, undefined props dropped, and every <Modal> rendered
 * with its visible / transparent / animationType / presentationStyle recorded
 * on a host View — so a Modal gaining `transparent={fP.transparent}` (undefined
 * on a phone) or `animationType={fP.animationType}` (the caller's own literal
 * on a phone) must still record exactly what it did. The clock is pinned (the
 * date picker's wheels and Today/Yesterday pills read `new Date()`).
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { setColorTheme } from '@/constants/colors';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';

// ── The layout gate: a width + a web flag, exactly like the app's hook ──────
let mockWidth = 390;
let mockHeight = 844;
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
      height: mockHeight,
      contentMaxWidth: isDesktop ? 1280 : isTablet ? 900 : mockWidth,
      sidebarWidth: isDesktop ? 240 : 0,
      showSidebar: isDesktop,
      ganttRowHeight: isDesktop ? 40 : isTablet ? 36 : 32,
    };
  },
}));

// useIsDesktopWeb(): the app's own answer (false on a phone), unless forced.
let mockForceDesktopWeb = false;
jest.mock('@/components/ui/desktop', () => {
  const actual = jest.requireActual('@/components/ui/desktop');
  return { ...actual, useIsDesktopWeb: () => (mockForceDesktopWeb ? actual.useIsDesktop() : actual.useIsDesktopWeb()) };
});

// Every Modal renders its content, open or closed, and records its props.
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const ReactActual = jest.requireActual('react');
  const { View: RNView, Text: RNText } = jest.requireActual('react-native');
  class Boundary extends ReactActual.Component<{ children?: React.ReactNode }, { threw: boolean }> {
    state = { threw: false };
    static getDerivedStateFromError() { return { threw: true }; }
    componentDidCatch() { /* recorded as a placeholder; identical before and after */ }
    render() {
      return this.state.threw
        ? ReactActual.createElement(RNText, { testID: 'modal-body-threw' }, 'modal-body-threw')
        : this.props.children;
    }
  }
  function Modal(props: Record<string, unknown> & { children?: React.ReactNode }) {
    const { children, visible, transparent, animationType, presentationStyle } = props;
    return ReactActual.createElement(
      RNView,
      {
        testID: 'w6c-modal',
        accessibilityHint: JSON.stringify({ visible: visible ?? null, transparent: transparent ?? null, animationType: animationType ?? null, presentationStyle: presentationStyle ?? null }),
      },
      ReactActual.createElement(Boundary, null, children),
    );
  }
  return { __esModule: true, default: Modal };
});

// ── Environment ────────────────────────────────────────────────────────────
let restoreOS: (() => void) | null = null;
function env(os: 'ios' | 'android' | 'web', width: number, height: number) {
  restoreOS?.();
  restoreOS = os === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', os).restore;
  mockWidth = width;
  mockHeight = height;
  mockWeb = os === 'web';
  Dimensions.set({
    window: { width, height, scale: 2, fontScale: 1 },
    screen: { width, height, scale: 2, fontScale: 1 },
  });
}

// The pinned clock: modern fake timers also fake `new Date()`.
const NOW = new Date('2026-08-15T15:00:00.000Z');
beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  allowConsoleErrors();
});
afterEach(() => {
  mockForceDesktopWeb = false;
  jest.useRealTimers();
  restoreOS?.();
  restoreOS = null;
});

// ── What a snapshot records ────────────────────────────────────────────────
const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;
function small(v: unknown): string | null {
  try {
    const j = JSON.stringify(v);
    return j !== undefined && j.length <= 600 ? j : null;
  } catch { return null; }
}
function dumpLines(node: unknown, depth: number, out: string[]): void {
  if (node == null) return;
  if (Array.isArray(node)) { for (const n of node) dumpLines(n, depth, out); return; }
  const pad = ' '.repeat(Math.min(depth, 200));
  if (typeof node !== 'object') { out.push(`${pad}"${String(node)}"`); return; }
  const el = node as { type: string; props: Record<string, unknown>; children: unknown };
  const parts: string[] = [];
  for (const k of Object.keys(el.props ?? {}).sort()) {
    const v = el.props[k];
    if (v === undefined || typeof v === 'function' || k === 'children') continue;
    if (/style$/i.test(k) && v != null && typeof v === 'object') { parts.push(`${k}=${small(flat(v)) ?? '<big>'}`); continue; }
    if (typeof v === 'string') { parts.push(`${k}=${JSON.stringify(v)}`); continue; }
    if (typeof v !== 'object' || v === null) { parts.push(`${k}=${String(v)}`); continue; }
    parts.push(`${k}=${small(v) ?? '<obj>'}`);
  }
  out.push(`${pad}<${el.type} ${parts.join(' ')}>`);
  dumpLines(el.children, depth + 1, out);
}
function fingerprint(name: string, json: unknown): { lines: number; sha256: string } {
  const out: string[] = [];
  dumpLines(json, 0, out);
  const text = out.join('\n');
  const dir = process.env.W6C_DUMP_DIR;
  if (dir) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/${name.replace(/[^a-z0-9]+/gi, '_')}.txt`, text);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sha256 = require('node:crypto').createHash('sha256').update(text).digest('hex');
  return { lines: out.length, sha256 };
}

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

async function pump(n = 4) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      jest.advanceTimersByTime(50);
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

type Scheme = 'light' | 'dark';
async function mount(node: React.ReactElement, scheme: Scheme) {
  await AsyncStorage.setItem('mageid_theme', scheme);
  // The static Colors mirror (constants/colors) is module state that the
  // provider only updates in an effect, AFTER a component's first styles are
  // built — so without this a light case would inherit the previous dark
  // case's static colours, and each golden would depend on test order.
  setColorTheme(scheme);
  const r = render(
    <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider><View>{node}</View></ThemeProvider></SafeAreaProvider>,
  );
  await pump();
  return r;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadDatePicker = () => require('@/components/DatePickerModal').default as typeof import('@/components/DatePickerModal').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadVoice = () => require('@/components/VoiceCaptureModal').default as typeof import('@/components/VoiceCaptureModal').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadSidePanel = () => require('@/components/desktop/SidePanel').SidePanel as typeof import('@/components/desktop/SidePanel').SidePanel;

const noop = () => {};

describe('lane V1 — the phone is unchanged (golden, 390 wide)', () => {
  jest.setTimeout(60000);

  const DATE_CASES: Array<['ios' | 'web', Scheme]> = [
    ['ios', 'light'], ['ios', 'dark'], ['web', 'light'], ['web', 'dark'],
  ];
  it.each(DATE_CASES)('DatePickerModal, visible — %s 390, %s', async (os, scheme) => {
    env(os, 390, 844);
    const DatePickerModal = loadDatePicker();
    const r = await mount(
      <DatePickerModal visible value="2026-08-10" onClose={noop} onChange={noop} title="Start date" allowFuture />,
      scheme,
    );
    expect(fingerprint(`date-${os}-${scheme}`, r.toJSON())).toMatchSnapshot();
  });

  it.each<Scheme>(['light', 'dark'])('VoiceCaptureModal, visible — ios 390, %s', async (scheme) => {
    env('ios', 390, 844);
    const VoiceCaptureModal = loadVoice();
    const r = await mount(
      <VoiceCaptureModal
        visible
        onClose={noop}
        onTranscriptReady={noop}
        title="Describe the change"
        contextLine="Henderson Residence"
        suggestions={['Push drywall two days', 'Add a 3 day inspection after framing']}
        topicChecklist={[{ label: 'Which task', hint: 'Framing, drywall…' }, { label: 'How long' }]}
      />,
      scheme,
    );
    expect(fingerprint(`voice-ios-${scheme}`, r.toJSON())).toMatchSnapshot();
  });

  it('SidePanel phone branch, open with a tab row — ios 390', async () => {
    env('ios', 390, 844);
    const SidePanel = loadSidePanel();
    const r = await mount(
      <SidePanel
        open
        onClose={noop}
        title="Schedule assistant"
        tabs={[{ key: 'change', label: 'Change' }, { key: 'ask', label: 'Ask' }]}
        activeTab="change"
        onTabChange={noop}
        testID="phone-panel"
      >
        <Text>Body</Text>
      </SidePanel>,
      'light',
    );
    expect(fingerprint('sidepanel-ios', r.toJSON())).toMatchSnapshot();
  });

  it('dark really is dark (the dark goldens are not the light ones)', async () => {
    env('ios', 390, 844);
    const DatePickerModal = loadDatePicker();
    const light = fingerprint('x', (await mount(<DatePickerModal visible value="2026-08-10" onClose={noop} onChange={noop} />, 'light')).toJSON());
    const dark = fingerprint('y', (await mount(<DatePickerModal visible value="2026-08-10" onClose={noop} onChange={noop} />, 'dark')).toJSON());
    expect(dark.sha256).not.toBe(light.sha256);
    await AsyncStorage.setItem('mageid_theme', 'light');
  });
});
