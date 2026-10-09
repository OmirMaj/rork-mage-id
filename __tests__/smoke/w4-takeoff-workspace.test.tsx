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
 *  5. List-3 lane TK-a: an empty takeoff shows six starter chips (one tap = a
 *     condition); the filter box narrows the rows, '/' focuses it and Esc in
 *     it clears it; '1' activates the first VISIBLE row and a digit typed in
 *     a field stays in the field; a picked swatch is the saved colour; an
 *     expanded row lists its measurements, whose delete drops the quantity;
 *     a sub-row on another sheet opens that sheet and selects it once ready.
 *     Vertex dragging and hover-to-thicken are DOM-only (mouse listeners /
 *     RN-web hover) — proved in scripts/validate-takeoff-conditions.ts
 *     (hitVertex) and live.
 *
 * Harness note (as in w6d-plans-phone): RN-web cannot run inside this native
 * harness, so the desktop-web cases keep Platform.OS native and force only
 * useIsDesktopWeb(). The DOM wheel/mouse listeners therefore do not attach
 * here (they are Platform.OS === 'web' only) — they are proved live.
 */

import React from 'react';
import { Dimensions, Image, Platform, StyleSheet, TextInput, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, SMOKE_USER } from '@/__tests__/fixtures/world';
import { hotkeys, type KeyLike } from '@/hooks/useHotkeys';
import { TAKEOFF_CONDITION_PALETTE } from '@/constants/colors';

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

/** The hotkey registry registers nothing without a DOM key target
 *  (domKeyTarget()), which this native harness lacks. Give it a minimal one
 *  for the body of `fn`, and unmount while the stub listeners still exist. */
type Mount = (...a: Parameters<typeof mountAt>) => Promise<unknown>;
async function withDomKeys(fn: (mount: Mount) => Promise<void>) {
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
    await fn(async (...args) => { const t0 = await mountAt(...args); tree = t0 as unknown as { unmount: () => void }; return t0; });
  } finally {
    if (tree) { const t0 = tree as { unmount: () => void }; await act(async () => { t0.unmount(); }); }
    if (typeof prevAdd !== 'function') delete win.addEventListener;
    if (typeof prevRemove !== 'function') delete win.removeEventListener;
    if (!hadDoc) delete g.document; else g.document = prevDoc;
    if (!hadWin) delete g.window;
  }
}
const key = (k: string, target: unknown = {}): KeyLike => ({ key: k, target, preventDefault: () => {} } as unknown as KeyLike);
const flatColor = (id: string) => flat(screen.getByTestId(id).props.style).backgroundColor;
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
    expect(screen.getByText('Trace It, Price It')).toBeTruthy();
  });

  it('desktop web 1512: the workspace mounts; no sheets → the first-run state', async () => {
    await mountAt('web', 1512, 945, `/area-takeoff?${P}`);
    expect(screen.getByTestId('takeoffws-root')).toBeTruthy();
    expect(screen.getByText('Measure a plan. Price it from your own projects.')).toBeTruthy();
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
    expect(textOf(screen.getByTestId('takeoffws-norate-c-base'))).toBe('No rate yet. Set one.');
    // All sheets: A-201's measurement (its own scale, its own aspect) is counted.
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-filter-all')); });
    await pump(2);
    expect(textOf(screen.getByTestId('takeoffws-qty-c-floor'))).toBe('4,000');
    expect(textOf(screen.getByTestId('takeoffws-amount-c-floor'))).toContain('18,000');
    expect(screen.queryByTestId('takeoffws-unmeasured-c-floor')).toBeNull();
    expect(textOf(screen.getByTestId('takeoffws-cost-line'))).toContain('1 has no rate yet');
    // Lane SYNC changes the wording (account sync); only the "Saved …" start is pinned here.
    expect(screen.getByTestId('takeoffws-save-line').props.children).toMatch(/^Saved /);
    expect(screen.getByTestId('takeoffws-scale-pill')).toBeTruthy();
    expect(textOf(screen.getByTestId('takeoffws-scale-pill'))).toBe('Scale Set');
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
    await act(async () => { fireEvent.press(screen.getByLabelText('Zoom In (+)')); });
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
    expect(r2).toContain('Already up to date, nothing changed');
    const m = /Estimate updated (\S+) → (\S+)/.exec(r2);
    expect(m && m[1]).toBe(m && m[2]);
  });
  // ── list-3 lane TK-a ────────────────────────────────────────────────────
  it('an empty takeoff shows six starter chips; one tap makes the condition and hides them', async () => {
    await mountAt('web', 1512, 945, `/area-takeoff?${P}`, seedSheets);
    expect(screen.getByTestId('takeoffws-starters')).toBeTruthy();
    const chips = screen.queryAllByTestId(/^takeoffws-starter-/);
    expect(chips).toHaveLength(6);
    // The fixture job is a Renovation → the default set, first chip LVT flooring (SF).
    expect(textOf(screen.getByTestId('takeoffws-starter-lvt'))).toMatch(/^LVT flooring · SF/);
    expect(screen.queryAllByTestId(/^takeoffws-row-press-/)).toHaveLength(0);
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-starter-lvt')); });
    await pump(2);
    const rows = screen.queryAllByTestId(/^takeoffws-row-press-/);
    expect(rows).toHaveLength(1);
    expect(rows[0].props.accessibilityState).toEqual({ selected: true });
    expect(textOf(rows[0])).toContain('LVT flooring');
    expect(screen.queryByTestId('takeoffws-starters')).toBeNull();
    // It went through saveCondition: the Area tool is on.
    expect(screen.getByTestId('takeoffws-tool-area').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('filter: typing narrows the rows; "/" focuses it; Esc in it clears it; "1" is the first VISIBLE row', async () => {
    await withDomKeys(async (mount) => {
      await mount('web', 1512, 945, `/area-takeoff?${P}`, seedAll);
      const rowIds = () => screen.queryAllByTestId(/^takeoffws-row-press-/).map((n) => String(n.props.testID));
      expect(rowIds()).toEqual(['takeoffws-row-press-c-floor', 'takeoffws-row-press-c-base']);
      // '/' is the page-scope binding while the workspace is mounted (no other scope holds it).
      const slash = hotkeys.list().filter((h) => h.combo === '/');
      expect(slash).toEqual([expect.objectContaining({ scope: 'page', label: 'Filter Conditions', group: 'Takeoff' })]);
      const focus = TextInput.prototype.focus as unknown as jest.Mock;
      focus.mockClear();
      let fired = false;
      await act(async () => { fired = hotkeys.handle(key('/')); });
      expect(fired).toBe(true);
      expect(focus.mock.instances.some((i) => (i as { props?: { testID?: string } })?.props?.testID === 'takeoffws-filter-input')).toBe(true);
      // Typing narrows (name or trade, any case).
      await act(async () => { fireEvent.changeText(screen.getByTestId('takeoffws-filter-input'), 'RUBBER'); });
      await pump(1);
      expect(rowIds()).toEqual(['takeoffws-row-press-c-base']);
      // A digit typed IN the field stays in the field.
      expect(hotkeys.handle(key('1', { tagName: 'INPUT', type: 'text' }))).toBe(false);
      // '1' = the first VISIBLE row (c-base, not c-floor).
      await act(async () => { hotkeys.handle(key('1')); });
      await pump(1);
      expect(screen.getByTestId('takeoffws-row-press-c-base').props.accessibilityState).toEqual({ selected: true });
      // '2' has no visible row → nothing changes.
      await act(async () => { hotkeys.handle(key('2')); });
      await pump(1);
      expect(screen.getByTestId('takeoffws-row-press-c-base').props.accessibilityState).toEqual({ selected: true });
      // No match → says so.
      await act(async () => { fireEvent.changeText(screen.getByTestId('takeoffws-filter-input'), 'zzz'); });
      await pump(1);
      expect(rowIds()).toEqual([]);
      expect(textOf(screen.getByTestId('takeoffws-filter-empty'))).toBe('No conditions match “zzz”');
      // Esc typed in the box clears it.
      const inBox = { closest: (sel: string) => (sel === '#takeoffws-filter-input-dom' ? {} : null) };
      await act(async () => { hotkeys.handle(key('Escape', inBox)); });
      await pump(1);
      expect(screen.getByTestId('takeoffws-filter-input').props.value).toBe('');
      expect(rowIds()).toHaveLength(2);
    });
  });

  it('the editor\'s colour swatches: a pick is the saved colour', async () => {
    await mountAt('web', 1512, 945, `/area-takeoff?${P}`, seedAll);
    expect(flatColor('takeoffws-swatch-c-base')).toBe('#94A3B8');
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-norate-c-base')); });
    await pump(2);
    const sw = screen.queryAllByTestId(/^takeoffws-color-\d+$/);
    expect(sw).toHaveLength(TAKEOFF_CONDITION_PALETTE.length);
    expect(screen.getByTestId('takeoffws-color-0').props.accessibilityState).toEqual({ selected: true });
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-color-4')); });
    await pump(1);
    expect(screen.getByTestId('takeoffws-color-4').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('takeoffws-color-0').props.accessibilityState).toEqual({ selected: false });
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-editor-save')); });
    await pump(2);
    expect(screen.queryByTestId('takeoffws-editor')).toBeNull();
    expect(flatColor('takeoffws-swatch-c-base')).toBe(TAKEOFF_CONDITION_PALETTE[4]);
  });

  it('an expanded row lists its measurements; delete drops the quantity; another sheet\'s opens that sheet', async () => {
    await mountAt('web', 1512, 945, `/area-takeoff?${P}`, seedAll);
    await act(async () => {
      fireEvent(screen.getByTestId('takeoffws-canvas'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 900, height: 800 } } });
    });
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-filter-all')); });
    await act(async () => { fireEvent.press(screen.getByLabelText('Expand LVT flooring')); });
    await pump(2);
    expect(textOf(screen.getByTestId('takeoffws-m-m-a'))).toBe('A-101 · Area 1 · 2,000 SF');
    expect(textOf(screen.getByTestId('takeoffws-m-m-b'))).toBe('A-201 · Area 1 · 2,000 SF');
    expect(screen.getByTestId('takeoffws-mdel-m-b').props.accessibilityLabel).toBe('Delete A-201 · Area 1 · 2,000 SF');
    // Click the A-201 one while A-101 is open: the sheet opens and, once its paper is ready, it is selected.
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-m-m-b')); });
    await pump(3);
    await act(async () => {
      fireEvent(screen.getByTestId('takeoffws-canvas'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 901, height: 800 } } });
    });
    await pump(3);
    expect(screen.getByTestId('takeoffws-m-m-b').props.accessibilityState).toEqual({ selected: true });
    expect(textOf(screen.getByTestId('takeoffws-status'))).toContain('Selected');
    // Delete it: gone, the row's quantity drops, the selection goes with it.
    expect(textOf(screen.getByTestId('takeoffws-qty-c-floor'))).toBe('4,000');
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-mdel-m-b')); });
    await pump(2);
    expect(screen.queryByTestId('takeoffws-m-m-b')).toBeNull();
    expect(textOf(screen.getByTestId('takeoffws-qty-c-floor'))).toBe('2,000');
    expect(textOf(screen.getByTestId('takeoffws-status'))).not.toContain('Selected');
  });
});

// ── Lane TK-b: AI suggestions from the AI Takeoff saved on this browser ──
const aiSavedTakeoff = () => ({
  result: {
    summary: 'Two-room fit-out', scale: { num: 0.25, unit: 'in', perValue: 1, perUnit: 'ft', label: '1/4" = 1\'-0"', confidence: 'high', sourcePages: [1] },
    drawingsSeen: [],
    walls: [],
    floorAreas: [{ id: 'f1', roomName: 'Kitchen', finishCode: 'T-1', areaSqFt: 180, ceilingHeightFt: 9, confidence: 'high', sourcePages: [2] }],
    doors: [{ id: 'd1', mark: 'D-1', description: 'Solid core', widthIn: 36, heightIn: 80, count: 6, confidence: 'medium', sourcePages: [3] }],
    windows: [{ id: 'n1', mark: 'W-1', description: 'Double hung', widthIn: 36, heightIn: 60, count: 4, confidence: 'low', sourcePages: [3] }],
    finishes: [],
    fixtures: [],
    bulkMaterials: [{ id: 'b1', description: 'Concrete slab', quantity: 12, unit: 'cy', confidence: 'medium', sourcePages: [1] }],
    concerns: [], doubleCheck: [], missingScopes: [], confidenceOverall: 'medium', confidenceExplanation: '',
  },
  overrides: {},
  rejected: { 'windows:n1': true },
  modelUsed: null,
  pages: [],
  fileName: 'plans.pdf',
  savedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
});
const seedAi = (raw: string) => async () => {
  await seedAll();
  await AsyncStorage.setItem(`mageid_takeoff::${PROJECT_ID}`, raw);
};

describe('lane TK-b — AI suggestions in the Conditions panel', () => {
  jest.setTimeout(120000);

  it('a saved AI Takeoff: 2 suggestions + skip lines; nothing counts until accepted; accept, then dismiss', async () => {
    await mountAt('web', 1512, 945, `/area-takeoff?${P}`, seedAi(JSON.stringify(aiSavedTakeoff())));
    expect(screen.getByTestId('takeoffws-ai')).toBeTruthy();
    expect(screen.getByText('Suggested by AI (2)')).toBeTruthy();
    expect(textOf(screen.getByTestId('takeoffws-ai-skipped-bulk'))).toBe('1 bulk material uses units this panel doesn’t measure (CY, tons…). See AI Takeoff.');
    expect(textOf(screen.getByTestId('takeoffws-ai-skipped-rejected'))).toContain('you rejected on AI Takeoff');
    expect(textOf(screen.getByTestId('takeoffws-ai-ready'))).toContain('Nothing here counts until you accept it.');
    // Suggestions are not conditions: the cost line and the push count are what the doc alone gives.
    const costBefore = textOf(screen.getByTestId('takeoffws-cost-line'));
    expect(costBefore).toContain('of 2 lines priced from your jobs');
    expect(costBefore).toContain('1 has no rate yet');
    expect(textOf(screen.getByTestId('takeoffws-push'))).toBe('Push 1 line to estimate');
    expect(screen.queryAllByTestId(/^takeoffws-airead-/)).toHaveLength(0);

    // Accept the door (row 1): it becomes a condition labelled "AI read — not measured" (All sheets).
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-ai-accept-1')); });
    await pump(2);
    expect(screen.getByText('Suggested by AI (1)')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-filter-all')); });
    await pump(2);
    const sub = screen.getAllByTestId(/^takeoffws-airead-/);
    expect(sub).toHaveLength(1);
    const newId = String(sub[0].props.testID).replace('takeoffws-airead-', '');
    expect(textOf(sub[0])).toBe('AI read, not measured · p.3 · plans.pdf · Medium confidence · draw it to measure');
    expect(textOf(screen.getByTestId(`takeoffws-qty-${newId}`))).toBe('6');
    // His book has no door rate in this world: it says so, and the push count holds (never an invented rate).
    expect(textOf(screen.getByTestId(`takeoffws-norate-${newId}`))).toBe('No rate yet. Set one.');
    expect(textOf(screen.getByTestId('takeoffws-push'))).toBe('Push 1 line to estimate');
    // He sets a rate: the push count moves now — and the AI read survives the edit.
    await act(async () => { fireEvent.press(screen.getByTestId(`takeoffws-norate-${newId}`)); });
    await pump(2);
    await act(async () => { fireEvent.changeText(screen.getByTestId('takeoffws-editor-rate'), '450'); });
    await pump(1);
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-editor-save')); });
    await pump(2);
    expect(textOf(screen.getByTestId('takeoffws-push'))).toBe('Push 2 lines to estimate');
    expect(textOf(screen.getByTestId(`takeoffws-airead-${newId}`))).toContain('AI read, not measured');
    expect(textOf(screen.getByTestId(`takeoffws-amount-${newId}`))).toContain('2,700');

    // Dismiss the other row: the section is empty.
    await act(async () => { fireEvent.press(screen.getByLabelText('Dismiss Kitchen · T-1')); });
    await pump(2);
    expect(screen.getByText('Suggested by AI (0)')).toBeTruthy();
    expect(screen.queryByTestId('takeoffws-ai-row-0')).toBeNull();
    // Every row handled, but rows were skipped: the section stays open, so the reasons still show.
    expect(textOf(screen.getByTestId('takeoffws-ai-done'))).toBe('Every AI suggestion is accepted or dismissed.');
    expect(screen.getByTestId('takeoffws-ai-skipped-bulk')).toBeTruthy();
  });

  it('no AI Takeoff saved on this browser → the "none" sentence and the Run AI Takeoff link', async () => {
    await mountAt('web', 1512, 945, `/area-takeoff?${P}`, seedAll);
    expect(textOf(screen.getByTestId('takeoffws-ai-none'))).toContain('No AI Takeoff saved on this browser for this project yet. An AI Takeoff run on your phone stays on that phone.');
    expect(textOf(screen.getByTestId('takeoffws-ai-run'))).toBe('Run AI Takeoff');
  });

  it('Run AI Takeoff and come back: the panel re-reads on focus; /takeoff re-saving never re-offers an accepted row', async () => {
    await mountAt('web', 1512, 945, `/area-takeoff?${P}`, seedAll);
    expect(screen.getByTestId('takeoffws-ai-none')).toBeTruthy();
    // The panel's own link pushes /takeoff on top; /area-takeoff stays mounted underneath.
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-ai-run')); });
    await pump(4);
    // …he runs AI Takeoff there (it saves on this browser), then comes back.
    await AsyncStorage.setItem(`mageid_takeoff::${PROJECT_ID}`, JSON.stringify(aiSavedTakeoff()));
    await act(async () => { router.back(); });
    await pump(4);
    expect(screen.getByText('Suggested by AI (2)')).toBeTruthy();
    expect(screen.queryByTestId('takeoffws-ai-none')).toBeNull();

    // Accept the door, then open /takeoff again: it restores the saved takeoff and
    // re-saves it with a NEW savedAt. Coming back must not offer the door again.
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-ai-accept-1')); });
    await pump(2);
    expect(screen.getByText('Suggested by AI (1)')).toBeTruthy();
    const before = JSON.parse((await AsyncStorage.getItem(`mageid_takeoff::${PROJECT_ID}`))!).savedAt;
    await act(async () => { router.push({ pathname: '/takeoff', params: { projectId: PROJECT_ID } }); });
    await pump(6);
    const after = JSON.parse((await AsyncStorage.getItem(`mageid_takeoff::${PROJECT_ID}`))!).savedAt;
    expect(after).not.toBe(before);
    await act(async () => { router.back(); });
    await pump(4);
    expect(screen.getByText('Suggested by AI (1)')).toBeTruthy();
    expect(screen.queryByLabelText('Accept D-1 Solid core')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-filter-all')); });
    await pump(2);
    expect(screen.getAllByTestId(/^takeoffws-airead-/)).toHaveLength(1);
  });

  it('an accepted AI read drawn on ANOTHER sheet: This sheet never says "see All sheets"; All sheets says measured', async () => {
    const doc = {
      version: 1,
      conditions: [{
        id: 'c-ai', name: 'D-1 Solid core', kind: 'count', trade: null, rateOverride: 450, wastePct: 0, heightFt: null, color: '#94A3B8',
        createdAt: '2026-09-01T12:00:00.000Z',
        aiRead: { qty: 6, unit: 'EA', confidence: 'medium', citation: 'p.3 · plans.pdf', key: 'rx|doors:d1', readAt: '2026-09-01T12:00:00.000Z' },
      }],
      measurements: [{ id: 'm-ai', conditionId: 'c-ai', sheetId: SB, kind: 'count', points: [{ x: 0.1, y: 0.1 }], createdAt: '2026-09-01T12:00:00.000Z', aspect: 0.75 }],
      pushed: {},
    };
    await mountAt('web', 1512, 945, `/area-takeoff?${P}`, async () => {
      await seedAll();
      await AsyncStorage.setItem(`mageid_takeoff_conditions::${PROJECT_ID}`, JSON.stringify(doc));
    });
    expect(screen.getByTestId('takeoffws-row-c-ai')).toBeTruthy();
    expect(screen.queryByTestId('takeoffws-airead-c-ai')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('takeoffws-filter-all')); });
    await pump(2);
    expect(textOf(screen.getByTestId('takeoffws-airead-c-ai'))).toBe('Measured · AI read was 6 EA');
  });

  it('a corrupt saved AI Takeoff → the failed sentence, never the none sentence', async () => {
    await mountAt('web', 1512, 945, `/area-takeoff?${P}`, seedAi('{not json'));
    expect(textOf(screen.getByTestId('takeoffws-ai-failed'))).toContain('Couldn’t read the AI Takeoff saved on this browser for this project.');
    expect(screen.getByTestId('takeoffws-ai-retry')).toBeTruthy();
    expect(screen.queryByTestId('takeoffws-ai-none')).toBeNull();
  });
});
