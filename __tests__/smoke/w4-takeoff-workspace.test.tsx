/**
 * Wave 4, lane T2 — the desktop web takeoff workspace (components/takeoff).
 * Behaviour assertions only; no snapshots. The PHONE proof is the existing
 * golden in w6c-field-phone.test.tsx (/area-takeoff on the phone, unchanged).
 *
 *  1. Phone 390 (native): /area-takeoff never mounts the workspace.
 *  2. Desktop web 1512 × 945: the workspace mounts; with no sheets it shows the
 *     first-run state; with sheets the rail lists every live sheet.
 *  3. A seeded takeoff doc renders its rows with quantities; the unpriced one
 *     says "No rate yet"; a measurement on a NON-active sheet that has a scale
 *     is counted in All sheets and never labelled "not measured"; the paper
 *     carries the transform with transform-origin 0 0.
 *  4. With the editor closed no dialog scope is registered (the editor subtree
 *     is absent), and it mounts only when opened.
 *
 * Harness note (as in w6d-plans-phone): RN-web cannot run inside this native
 * harness, so the desktop-web cases keep Platform.OS native and force only
 * useIsDesktopWeb(). The DOM wheel/mouse listeners therefore do not attach
 * here (they are Platform.OS === 'web' only) — they are proved live.
 */

import React from 'react';
import { Dimensions, Image, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, SMOKE_USER } from '@/__tests__/fixtures/world';
import { hotkeys } from '@/hooks/useHotkeys';

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

let mockForceDesktopWeb = false;
jest.mock('@/components/ui/desktop', () => {
  const actual = jest.requireActual('@/components/ui/desktop');
  return { ...actual, useIsDesktopWeb: () => (mockForceDesktopWeb ? actual.useIsDesktop() : actual.useIsDesktopWeb()) };
});

let restoreOS: (() => void) | null = null;
function env(os: 'ios' | 'web', width: number, height: number) {
  restoreOS?.();
  const platform = 'ios' as typeof Platform.OS;
  restoreOS = platform === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', platform).restore;
  mockWidth = width;
  mockHeight = height;
  mockWeb = os === 'web';
  Dimensions.set({
    window: { width, height, scale: 2, fontScale: 1 },
    screen: { width, height, scale: 2, fontScale: 1 },
  });
}

let sizeSpy: jest.SpyInstance | null = null;
beforeEach(() => {
  jest.useRealTimers();
  allowConsoleErrors();
  sizeSpy = jest.spyOn(Image, 'getSize').mockImplementation(((_uri: string, ok?: (w: number, h: number) => void) => { ok?.(1000, 750); }) as never);
});
afterEach(() => {
  mockForceDesktopWeb = false;
  sizeSpy?.mockRestore();
  sizeSpy = null;
  restoreOS?.();
  restoreOS = null;
});

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;
const textOf = (node: unknown): string => {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (typeof n === 'string') { out.push(n); return; }
    for (const k of ((n as { children?: unknown[] })?.children ?? [])) walk(k);
  };
  walk(node);
  return out.join('');
};

// ── Seeds ────────────────────────────────────────────────────────────────
const SA = 'sheet-t2-a101';
const SB = 'sheet-t2-a201';
const SC = 'sheet-t2-cover';
const sheet = (over: Record<string, unknown>) => ({
  projectId: PROJECT_ID,
  userId: SMOKE_USER.id,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  ...over,
});
const planSheets = [
  sheet({ id: SA, name: 'Floor Plan — Level 1', sheetNumber: 'A-101', imageUri: 'https://plans.example.test/a101.png' }),
  sheet({ id: SB, name: 'Floor Plan — Level 2', sheetNumber: 'A-201', imageUri: 'https://plans.example.test/a201.png' }),
  sheet({ id: SC, name: 'Cover', imageUri: 'https://plans.example.test/cover.png' }),
];
// 100 ft across the full sheet width, stamped in the image frame (ready).
const cal = (id: string, planSheetId: string) => ({
  id, planSheetId, projectId: PROJECT_ID,
  p1: { x: 0, y: 0.5, frame: 'image' }, p2: { x: 1, y: 0.5, frame: 'image' },
  realDistanceFt: 100, createdAt: '2026-08-01T12:00:00.000Z',
});
// A 50 ft × 40 ft rectangle at aspect 0.75 (H = 1000 / 0.75 ref px; 0.3 of it = 40 ft) = 2,000 SF.
const rect = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.3 }, { x: 0, y: 0.3 }];
const takeoffDoc = {
  version: 1,
  conditions: [
    { id: 'c-floor', name: 'LVT flooring', kind: 'area', trade: null, rateOverride: 4.5, wastePct: 0, heightFt: null, color: '#22C55E', createdAt: '2026-09-01T12:00:00.000Z' },
    { id: 'c-base', name: 'Rubber base', kind: 'linear', trade: null, rateOverride: null, wastePct: 0, heightFt: null, color: '#94A3B8', createdAt: '2026-09-01T12:00:00.000Z' },
  ],
  measurements: [
    { id: 'm-a', conditionId: 'c-floor', sheetId: SA, kind: 'area', points: rect, createdAt: '2026-09-01T12:00:00.000Z', aspect: 0.75 },
    { id: 'm-b', conditionId: 'c-floor', sheetId: SB, kind: 'area', points: rect, createdAt: '2026-09-01T12:00:00.000Z', aspect: 0.75 },
    { id: 'm-c', conditionId: 'c-base', sheetId: SA, kind: 'linear', points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }], createdAt: '2026-09-01T12:00:00.000Z', aspect: 0.75 },
  ],
  pushed: {},
};

async function mountAt(os: 'ios' | 'web', width: number, height: number, url: string, seed?: () => Promise<void>) {
  env(os, width, height);
  mockForceDesktopWeb = os === 'web';
  await primeWorld('populated');
  if (seed) await seed();
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}
const P = `projectId=${PROJECT_ID}`;
const seedSheets = async () => { await AsyncStorage.setItem('mageid_plan_sheets', JSON.stringify(planSheets)); };
const seedAll = async () => {
  await seedSheets();
  await AsyncStorage.setItem('mageid_plan_calibrations', JSON.stringify([cal('cal-a', SA), cal('cal-b', SB)]));
  await AsyncStorage.setItem(`mageid_takeoff_conditions::${PROJECT_ID}`, JSON.stringify(takeoffDoc));
};

describe('lane T2 — desktop takeoff workspace', () => {
  jest.setTimeout(120000);

  it('phone 390 (native): /area-takeoff keeps the touch flow — no workspace', async () => {
    await mountAt('ios', 390, 844, `/area-takeoff?${P}`, seedAll);
    expect(screen.queryByTestId('takeoffws-root')).toBeNull();
    expect(screen.getByText('Trace it, price it')).toBeTruthy();
  });

  it('desktop web 1512: the workspace mounts; no sheets → the first-run state', async () => {
    await mountAt('web', 1512, 945, `/area-takeoff?${P}`);
    expect(screen.getByTestId('takeoffws-root')).toBeTruthy();
    expect(screen.getByText('Measure a plan. Price it from your own jobs.')).toBeTruthy();
    expect(screen.getByTestId('takeoffws-upload-plans')).toBeTruthy();
    expect(screen.getByText('1 Set scale (K) · 2 Pick a condition · 3 Click to measure')).toBeTruthy();
  });

  it('desktop web 1512: with sheets the rail lists every live sheet, in number order', async () => {
    await mountAt('web', 1512, 945, `/area-takeoff?${P}`, seedSheets);
    const rows = screen.queryAllByTestId(/^plan-rail-sheet-t2-/).map((n) => String(n.props.testID));
    expect(rows).toEqual([`plan-rail-${SA}`, `plan-rail-${SB}`, `plan-rail-${SC}`]);
    expect(screen.queryByTestId('takeoffws-firstrun')).toBeNull();
    expect(screen.getByTestId('takeoffws-canvas')).toBeTruthy();
  });

  it('a seeded doc: rows, quantities, "No rate yet", and a scaled non-active sheet counts in All sheets', async () => {
    await mountAt('web', 1512, 945, `/area-takeoff?${P}`, seedAll);
    // This sheet (A-101): the floor is 2,000 SF.
    expect(textOf(screen.getByTestId('takeoffws-qty-c-floor'))).toBe('2,000');
    expect(textOf(screen.getByTestId('takeoffws-amount-c-floor'))).toContain('9,000');
    // The unpriced condition: a dash and the words, never $0.
    expect(textOf(screen.getByTestId('takeoffws-amount-c-base'))).toBe('—');
    expect(textOf(screen.getByTestId('takeoffws-norate-c-base'))).toBe('No rate yet — set one');
    // All sheets: A-201's measurement (its own scale, its own aspect) is counted.
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-filter-all')); });
    await pump(2);
    expect(textOf(screen.getByTestId('takeoffws-qty-c-floor'))).toBe('4,000');
    expect(textOf(screen.getByTestId('takeoffws-amount-c-floor'))).toContain('18,000');
    expect(screen.queryByTestId('takeoffws-unmeasured-c-floor')).toBeNull();
    expect(textOf(screen.getByTestId('takeoffws-cost-line'))).toContain('1 has no rate yet');
    expect(screen.getByText('Saved on this browser')).toBeTruthy();
    expect(screen.getByTestId('takeoffws-scale-pill')).toBeTruthy();
    expect(textOf(screen.getByTestId('takeoffws-scale-pill'))).toBe('Scale set');
  });

  it('the paper carries translate/scale with transform-origin 0 0 once the canvas is laid out', async () => {
    await mountAt('web', 1512, 945, `/area-takeoff?${P}`, seedAll);
    await act(async () => {
      fireEvent(screen.getByTestId('takeoffws-canvas'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 900, height: 800 } } });
    });
    await pump(2);
    const s = flat(screen.getByTestId('takeoffws-paper').props.style) as ViewStyle & { transformOrigin?: string };
    expect(s.transformOrigin).toBe('0 0');
    expect(s.transform).toEqual([{ translateX: 0 }, { translateY: 0 }, { scale: 1 }]);
    // fitRect at aspect 1000/750 inside 900 × 800 with a 24 pad: 852 wide.
    expect(s.width).toBeCloseTo(852, 5);
    expect(textOf(screen.getByTestId('takeoffws-zoom-pct'))).toBe('100%');
    // The zoom control scales about the centre.
    await act(async () => { fireEvent.press(screen.getByLabelText('Zoom in (+)')); });
    await pump(1);
    expect(textOf(screen.getByTestId('takeoffws-zoom-pct'))).toBe('125%');
  });

  it('the condition editor is absent while closed (no dialog scope), and mounts when opened', async () => {
    // The hotkey registry registers nothing without a DOM key target
    // (domKeyTarget()), which this native harness lacks — so a bare
    // hasDialog()===false would prove nothing. Give it a minimal one for this
    // test only, so the open editor's dialog scope really is counted.
    const g = globalThis as unknown as { document?: unknown; window?: Record<string, unknown> };
    const hadDoc = 'document' in g;
    const prevDoc = g.document;
    const win = (g.window ?? g) as Record<string, unknown>;
    const hadWin = 'window' in g;
    const prevAdd = win.addEventListener;
    const prevRemove = win.removeEventListener;
    if (!hadWin) g.window = win;
    if (!hadDoc) g.document = {};
    if (typeof prevAdd !== 'function') win.addEventListener = () => {};
    if (typeof prevRemove !== 'function') win.removeEventListener = () => {};
    let tree: { unmount: () => void } | null = null;
    try {
      tree = await mountAt('web', 1512, 945, `/area-takeoff?${P}`, seedAll);
      expect(screen.queryByTestId('takeoffws-editor')).toBeNull();
      expect(screen.queryByTestId('takeoffws-scale-dialog')).toBeNull();
      expect(hotkeys.hasDialog()).toBe(false);
      await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-new-condition')); });
      await pump(2);
      expect(screen.getByTestId('takeoffws-editor-name')).toBeTruthy();
      // The false above only proves something if the registry counts this dialog.
      expect(hotkeys.hasDialog()).toBe(true);
    } finally {
      // Unmount while the stub listeners still exist: the hooks' cleanup detaches through them.
      if (tree) { const t0 = tree; await act(async () => { t0.unmount(); }); }
      if (typeof prevAdd !== 'function') delete win.addEventListener;
      if (typeof prevRemove !== 'function') delete win.removeEventListener;
      if (!hadDoc) delete g.document; else g.document = prevDoc;
      if (!hadWin) delete g.window;
    }
  });

  it('push: one priced line lands on the estimate and the result line says what moved', async () => {
    await mountAt('web', 1512, 945, `/area-takeoff?${P}`, seedAll);
    expect(textOf(screen.getByTestId('takeoffws-push'))).toBe('Push 1 line to estimate');
    expect(textOf(screen.getByTestId('takeoffws-cost-line'))).toMatch(/ of \d+ lines? priced from your jobs/);
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-push')); });
    await pump(3);
    const r = textOf(screen.getByTestId('takeoffws-push-result'));
    expect(r).toContain('Estimate updated');
    expect(r).toContain('0 updated, 1 added');
    // A second push of the same lines matches the line it wrote: nothing added, the total holds.
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-push')); });
    await pump(3);
    const r2 = textOf(screen.getByTestId('takeoffws-push-result'));
    expect(r2).toContain('Already up to date — nothing changed');
    const m = /Estimate updated (\S+) → (\S+)/.exec(r2);
    expect(m && m[1]).toBe(m && m[2]);
  });
});
