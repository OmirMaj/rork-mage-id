/**
 * Slick round 3, lane A1 — the front door. GOLDEN.
 *
 * Recorded FIRST, on the untouched base (2cff3bd7), before a line of the lane
 * was written, and never regenerated. The lane adds a cold-start hand-off
 * (BrandSplash → the login / signup wordmark, a staggered entrance) and a
 * reload veil. Every piece of it is ARMED only by a launch phase that jest
 * never reaches (BrandSplash is mocked out below AND its module-scope mark is
 * guarded by JEST_WORKER_ID), so at rest /login and /signup must be
 * byte-identical: no slot wrapper, no hidden wordmark, no veil.
 *
 * Cases: /login and /signup at 390 × 844 iOS (phone), and at 1280 × 800 with
 * the desktop-web layout forced on. RN-web cannot run inside this native
 * harness (expo-router reads window.location on web — see w6d-b1-desktop), so
 * the desktop cases keep Platform.OS native and force useIsDesktopWeb() on,
 * the w6d-*-desktop pattern.
 *
 * What a snapshot records: w6d-z2-phone's one-line-per-host-node dump (styles
 * flattened, handlers and undefined props dropped), reduced to its line count
 * and sha256. Set SLICK3_DUMP_DIR to write each dump for a diff.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { act } from '@testing-library/react-native';
import { mountRouteChecked, primeSignedOut } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';

// Belt and braces: the splash never mounts in any golden.
jest.mock('@/components/BrandSplash', () => () => null);

// ── The layout gate ────────────────────────────────────────────────────────
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

// useIsDesktopWeb(): the app's own answer everywhere (false on iOS/Android).
let mockForceDesktopWeb = false;
jest.mock('@/components/ui/desktop', () => {
  const actual = jest.requireActual('@/components/ui/desktop');
  return { ...actual, useIsDesktopWeb: () => (mockForceDesktopWeb ? actual.useIsDesktop() : actual.useIsDesktopWeb()) };
});

// Every Modal renders its content, open or closed (w6c-field-phone's mock).
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
        testID: 'slick3-modal',
        accessibilityHint: JSON.stringify({ visible: visible ?? null, transparent: transparent ?? null, animationType: animationType ?? null, presentationStyle: presentationStyle ?? null }),
      },
      ReactActual.createElement(Boundary, null, children),
    );
  }
  return { __esModule: true, default: Modal };
});

// ── Environment ────────────────────────────────────────────────────────────
let restoreOS: (() => void) | null = null;
function env(os: 'ios' | 'android', width: number, height: number, desktopWeb = false) {
  restoreOS?.();
  restoreOS = os === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', os).restore;
  mockWidth = width;
  mockHeight = height;
  mockWeb = desktopWeb;
  mockForceDesktopWeb = desktopWeb;
  Dimensions.set({
    window: { width, height, scale: 2, fontScale: 1 },
    screen: { width, height, scale: 2, fontScale: 1 },
  });
}

// Two clocks, both pinned (see w6c-field-phone for why the OUTER realm's Date
// has to be pinned too: renderRouter's fake clock starts from it).
const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-26T14:31:00.000Z').getTime();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const outerFs = require('node:fs') as { readFileSync: { constructor: FunctionConstructor } };
const OuterDate = outerFs.readFileSync.constructor('return Date')() as DateConstructor;

let nowSpy: jest.SpyInstance | null = null;
let outerNowSpy: jest.SpyInstance | null = null;
beforeEach(() => {
  jest.useRealTimers();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  outerNowSpy = OuterDate === Date ? null : jest.spyOn(OuterDate, 'now').mockReturnValue(GOLDEN_CLOCK);
  allowConsoleErrors();
});
afterEach(() => {
  mockForceDesktopWeb = false;
  mockWeb = false;
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
  restoreOS?.();
  restoreOS = null;
});

// ── What a snapshot records ────────────────────────────────────────────────
const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;
const volatile = (s: string) => s
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<uuid>')
  .replace(/\b\d{13}[a-z0-9]{0,12}\b/g, '<ts-id>');
function small(v: unknown): string | null {
  try {
    const j = JSON.stringify(v);
    return j !== undefined && j.length <= 600 ? volatile(j) : null;
  } catch { return null; }
}
function dumpLines(node: unknown, depth: number, out: string[]): void {
  if (node == null) return;
  if (Array.isArray(node)) { for (const n of node) dumpLines(n, depth, out); return; }
  const pad = ' '.repeat(Math.min(depth, 200));
  if (typeof node !== 'object') { out.push(`${pad}"${volatile(String(node))}"`); return; }
  const el = node as { type: string; props: Record<string, unknown>; children: unknown };
  const parts: string[] = [];
  for (const k of Object.keys(el.props ?? {}).sort()) {
    const v = el.props[k];
    if (v === undefined || typeof v === 'function' || k === 'children' || k === 'screenId') continue;
    if (/style$/i.test(k) && v != null && typeof v === 'object') { parts.push(`${k}=${small(flat(v)) ?? '<big>'}`); continue; }
    if (typeof v === 'string') { parts.push(`${k}=${JSON.stringify(volatile(v))}`); continue; }
    if (typeof v !== 'object' || v === null) { parts.push(`${k}=${String(v)}`); continue; }
    parts.push(`${k}=${small(v) ?? '<obj>'}`);
  }
  out.push(`${pad}<${el.type} ${parts.join(' ')}>`);
  dumpLines(el.children, depth + 1, out);
}
function fingerprint(name: string, json: unknown): { lines: number; sha256: string } {
  json = stripSanctioned(json);
  const out: string[] = [];
  dumpLines(json, 0, out);
  const text = out.join('\n');
  const dir = process.env.SLICK3_DUMP_DIR;
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

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

async function frontDoor(url: string, desktop: boolean) {
  if (desktop) env('ios', 1280, 800, true);
  else env('ios', 390, 844);
  await primeSignedOut();
  const tree = await mountRouteChecked(url);
  await pump();
  expect(tree.getPathname()).toBe(url);
  return tree;
}

/** No splash and no reload veil in any front-door tree. */
function assertNoCurtain(json: unknown) {
  const text = JSON.stringify(json);
  expect(text).not.toContain('"brand-splash"');
  expect(text).not.toContain('"root-nav-reload-overlay"');
}

// ── GOLDEN ─────────────────────────────────────────────────────────────────
describe('slick3 front door golden — /login and /signup at rest', () => {
  jest.setTimeout(120000);

  it('(a) /login phone 390 × 844 iOS', async () => {
    const tree = await frontDoor('/login', false);
    const json = tree.toJSON();
    assertNoCurtain(json);
    expect(fingerprint('a-login-phone', json)).toMatchSnapshot();
  });

  it('(b) /signup phone 390 × 844 iOS', async () => {
    const tree = await frontDoor('/signup', false);
    const json = tree.toJSON();
    assertNoCurtain(json);
    expect(fingerprint('b-signup-phone', json)).toMatchSnapshot();
  });

  it('(c) /login desktop 1280 × 800 (desktop-web layout forced)', async () => {
    const tree = await frontDoor('/login', true);
    const json = tree.toJSON();
    assertNoCurtain(json);
    expect(fingerprint('c-login-desktop', json)).toMatchSnapshot();
  });

  it('(d) /signup desktop 1280 × 800 (desktop-web layout forced)', async () => {
    const tree = await frontDoor('/signup', true);
    const json = tree.toJSON();
    assertNoCurtain(json);
    expect(fingerprint('d-signup-desktop', json)).toMatchSnapshot();
  });
});
