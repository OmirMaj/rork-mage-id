/**
 * Smoke — the motion system (smoothness pass, lane 1: components/ui/motion.ts,
 * Button, Sheet).
 *
 * THE PROMISE THIS PROVES: at rest nothing changes. Every motion style is null
 * until a user-driven transition (a sheet opening, a key changing) has been
 * seen after mount; web CSS motion never reaches native; Reduce Motion turns
 * all of it off; a sheet that does not opt into `rise` is exactly today's.
 */

import React from 'react';
import { LayoutAnimation, Platform, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';
import { DataTable, type DataTableColumn } from '@/components/desktop/DataTable';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  Button,
  layoutNext,
  registerWithMotion,
  useRiseOnOpen,
  useSheetFrame,
  useSwapFade,
  useWebSwap,
  webMotion,
  type SheetFrame,
} from '@/components/ui';

let mockWidth = 390;
let mockWeb = false;
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => {
    const isDesktop = mockWidth >= 1024 || (mockWeb && mockWidth >= 900);
    return {
      screenSize: isDesktop ? 'desktop' : 'phone',
      isPhone: !isDesktop,
      isTablet: false,
      isDesktop,
      width: mockWidth,
      height: 945,
      contentMaxWidth: isDesktop ? 1400 : mockWidth,
      sidebarWidth: isDesktop ? 240 : 0,
      showSidebar: isDesktop,
      ganttRowHeight: 32,
    };
  },
}));
jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const Wrap = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
);
const flat = (s: unknown) => (StyleSheet.flatten(s as StyleProp<ViewStyle>) ?? {}) as Record<string, unknown>;

let restoreOS: (() => void) | null = null;
function web(width = 1512) {
  mockWidth = width;
  mockWeb = true;
  restoreOS = jest.replaceProperty(Platform, 'OS', 'web').restore;
}
afterEach(() => {
  restoreOS?.();
  restoreOS = null;
  mockWidth = 390;
  mockWeb = false;
});

describe('web CSS motion', () => {
  it('is null on native, so no native tree ever carries it', () => {
    expect(webMotion('fadeIn')).toBeNull();
    expect(webMotion('bgGlide')).toBeNull();
    const base = { borderRadius: 4 };
    expect(registerWithMotion(base, 'popIn')).toBe(base);
  });

  it('on web: keyframes registered, durations and transforms as CSS strings, fill backwards', () => {
    web();
    for (const key of ['fadeIn', 'popIn', 'dropIn', 'slideInRight', 'pulse'] as const) {
      const s = flat(webMotion(key));
      expect(Array.isArray(s.animationKeyframes)).toBe(true);
      expect(typeof s.animationDuration).toBe('string');
      expect(s.animationDuration).toMatch(/^\d+ms$/);
      expect(s.animationFillMode).toBe('backwards');
      const frames = s.animationKeyframes as { from: Record<string, unknown> }[];
      if ('transform' in frames[0].from) expect(typeof frames[0].from.transform).toBe('string');
    }
    for (const key of ['bgGlide', 'rotateGlide'] as const) {
      const s = flat(webMotion(key));
      expect(s.transitionDuration).toMatch(/^\d+ms$/);
      expect(String(s.transitionProperty)).not.toMatch(/opacity|width|height|left|top/);
    }
    const merged = flat(registerWithMotion({ borderRadius: 4 }, 'popIn'));
    expect(merged.borderRadius).toBe(4);
    expect(merged.animationDuration).toBe('180ms');
  });
});

describe('layoutNext', () => {
  it('native: opacity-only create/delete (never scaleXY); web: nothing', () => {
    const spy = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {});
    layoutNext();
    expect(spy).toHaveBeenCalledTimes(1);
    const cfg = spy.mock.calls[0][0] as { create?: { property?: string }; delete?: { property?: string }; duration: number };
    expect(cfg.create?.property).toBe('opacity');
    expect(cfg.delete?.property).toBe('opacity');
    expect(cfg.duration).toBe(240);
    web();
    layoutNext();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('hooks are null at rest', () => {
  it('useRiseOnOpen: null at mount (open or closed), a translateY after the first open', () => {
    let out: ViewStyle | null = { opacity: 1 };
    function Probe({ visible }: { visible: boolean }) {
      out = useRiseOnOpen(visible);
      return null;
    }
    const r = render(<Probe visible />);
    expect(out).toBeNull();
    r.rerender(<Probe visible={false} />);
    expect(out).toBeNull();
    r.rerender(<Probe visible />);
    expect(out).not.toBeNull();
    expect(Object.keys(out as unknown as object)).toEqual(['transform']);
    r.unmount();
  });

  it('useSwapFade: null until the key changes, then opacity only on native', () => {
    let out: ViewStyle | null = { opacity: 1 };
    function Probe({ k }: { k: string }) {
      out = useSwapFade(k);
      return null;
    }
    const r = render(<Probe k="a" />);
    expect(out).toBeNull();
    r.rerender(<Probe k="a" />);
    expect(out).toBeNull();
    r.rerender(<Probe k="b" />);
    expect(out).not.toBeNull();
    expect(Object.keys(out as unknown as object)).toEqual(['opacity']);
    r.unmount();
  });
});

describe('useWebSwap', () => {
  function run(keys: string[]): (ViewStyle | null)[] {
    const seen: (ViewStyle | null)[] = [];
    function Probe({ k }: { k: string }) {
      seen.push(useWebSwap(k));
      return null;
    }
    const r = render(<Probe k={keys[0]} />);
    for (const k of keys.slice(1)) r.rerender(<Probe k={k} />);
    r.unmount();
    return seen;
  }

  it('native: always null, even across key changes', () => {
    expect(run(['a', 'b', 'c']).every((s) => s === null)).toBe(true);
  });

  it('web: null at mount and on a same-key re-render', () => {
    web();
    expect(run(['a', 'a'])).toEqual([null, null]);
  });

  it('web: two key changes alternate two DIFFERENT fades (distinct keyframes), stable on a same-key re-render', () => {
    web();
    const [mount, first, same, second] = run(['a', 'b', 'b', 'c']);
    expect(mount).toBeNull();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(same).toBe(first);
    expect(second).not.toBe(first);
    const a = flat(first);
    const b = flat(second);
    expect(a.animationDuration).toBe('140ms');
    expect(b.animationDuration).toBe('140ms');
    expect(a.animationFillMode).toBe('backwards');
    expect(b.animationFillMode).toBe('backwards');
    expect(JSON.stringify(a.animationKeyframes)).not.toBe(JSON.stringify(b.animationKeyframes));
    expect(flat(webMotion('fadeIn'))).toEqual(a);
  });
});

describe('DataTable: rows that APPEAR fade in (desktop web)', () => {
  type Row = { id: string };
  const COLS: DataTableColumn<Row>[] = [{ key: 'id', label: 'Id', flex: 1 }];
  const mk = (ids: string[]) => ids.map((id) => ({ id }));
  type Inst = { parent: Inst | null; props: Record<string, unknown>; type: unknown };
  /** The row's own host View (the one DataRow styles), above its Pressable. */
  function rowStyle(key: string): Record<string, unknown> {
    let n = (screen.getByTestId(`t-row-${key}`) as unknown as Inst).parent;
    while (n && typeof n.type !== 'string') n = n.parent;
    return flat(n?.props.style);
  }
  const fading = (keys: string[]) => keys.filter((k) => Array.isArray(rowStyle(k).animationKeyframes));

  it('mount: nothing fades; appearing rows fade with a capped string stagger; staying rows, a re-render, a reorder and a removal never do', () => {
    web();
    let setRows!: (r: Row[]) => void;
    function Host() {
      const [rows, set] = React.useState<Row[]>(mk(['a', 'b']));
      setRows = set;
      // An inline rowKey: a new function (and a new visibleKeys array) on
      // every render — the same keys must not count as a change.
      return <DataTable tableId="t" columns={COLS} rows={rows} rowKey={(r) => r.id} renderCard={(r) => <Text>{r.id}</Text>} hotkeys={false} testID="t" />;
    }
    renderRouter({ index: Host }, { initialUrl: '/' });
    expect(fading(['a', 'b'])).toEqual([]);

    act(() => setRows(mk(['a', 'b', 'c', 'd'])));
    expect(fading(['a', 'b', 'c', 'd'])).toEqual(['c', 'd']);
    expect(rowStyle('c').animationDelay).toBe('0ms');
    expect(rowStyle('d').animationDelay).toBe('16ms');
    expect(rowStyle('c').animationDuration).toBe('140ms');

    // A follow-up render with the same keys keeps the fade (never cancelled mid-flight).
    act(() => setRows(mk(['a', 'b', 'c', 'd'])));
    expect(fading(['a', 'b', 'c', 'd'])).toEqual(['c', 'd']);

    // A sort: same keys, new order → nothing fades.
    act(() => setRows(mk(['d', 'c', 'b', 'a'])));
    expect(fading(['a', 'b', 'c', 'd'])).toEqual([]);

    // A filter that only removes rows → nothing fades.
    act(() => setRows(mk(['d', 'a'])));
    expect(fading(['a', 'd'])).toEqual([]);

    // 40 appear: the first 30 fade, the stagger stops at 8 × 16 = 128 ms, the rest just show.
    const many = Array.from({ length: 40 }, (_, i) => `n${i}`);
    act(() => setRows(mk(['d', 'a', ...many])));
    expect(fading(['d', 'a'])).toEqual([]);
    expect(fading(many)).toEqual(many.slice(0, 30));
    expect(rowStyle('n8').animationDelay).toBe('128ms');
    expect(rowStyle('n29').animationDelay).toBe('128ms');
  });
});

describe('useSheetFrame rise', () => {
  function frames(rise: boolean | undefined) {
    const seen: SheetFrame[] = [];
    function Probe({ visible }: { visible: boolean }) {
      seen.push(useSheetFrame('form', { visible, animationType: 'slide', rise }));
      return null;
    }
    const r = render(<Wrap><Probe visible={false} /></Wrap>);
    r.rerender(<Wrap><Probe visible /></Wrap>);
    r.unmount();
    return seen;
  }

  it('without rise a phone frame is exactly today’s: the caller’s slide, cardMotion null', () => {
    for (const f of frames(undefined)) {
      expect(f.animationType).toBe('slide');
      expect(f.cardMotion).toBeNull();
      expect(f.card).toBeNull();
    }
  });

  it('with rise: the scrim fades and the card rises, but only after an open', () => {
    const seen = frames(true);
    expect(seen.every((f) => f.animationType === 'fade')).toBe(true);
    expect(seen[0].cardMotion).toBeNull();
    expect(seen[seen.length - 1].cardMotion).not.toBeNull();
  });

  it('desktop: the card carries its CSS entry, cardMotion stays null', () => {
    web();
    const seen = frames(true);
    const last = seen[seen.length - 1];
    expect(last.cardMotion).toBeNull();
    expect(last.animationType).toBe('fade');
    expect(flat(last.card)).toMatchObject({ maxWidth: 560, animationDuration: '180ms' });
  });
});

describe('Button', () => {
  it('desktop web: loading keeps the label row (invisible) under the spinner, so the width holds', () => {
    web();
    const r = render(
      <Wrap>
        <Button label="Save" onPress={() => {}} loading testID="b" />
      </Wrap>,
    );
    const label = r.getByText('Save');
    expect(label).toBeTruthy();
    // The row holding the label is hidden, not removed.
    type Inst = { parent: Inst | null; props: Record<string, unknown>; type: unknown };
    const isRow = (x: Inst) => typeof x.type === 'string' && flat(x.props.style).flexDirection === 'row';
    let n: Inst | null = label as unknown as Inst;
    while (n && !isRow(n)) n = n.parent;
    expect(n ? flat(n.props.style).opacity : null).toBe(0);
    r.unmount();
  });

  it('desktop web: an un-hovered style is the plain desktop array (no trailing entry)', () => {
    web();
    const r = render(
      <Wrap>
        <Button label="Go" onPress={() => {}} testID="g" />
      </Wrap>,
    );
    const style = r.getByTestId('g').props.style as unknown[];
    expect(Array.isArray(style)).toBe(true);
    expect(style).toHaveLength(6);
    r.unmount();
  });

  it('phone: loading keeps the label row (invisible) under the spinner too (round 2: the width holds)', () => {
    const r = render(<Wrap><Button label="Save" onPress={() => {}} loading /></Wrap>);
    type Inst = { parent: Inst | null; props: Record<string, unknown>; type: unknown };
    const isRow = (x: Inst) => typeof x.type === 'string' && flat(x.props.style).flexDirection === 'row';
    let n: Inst | null = r.getByText('Save') as unknown as Inst;
    while (n && !isRow(n)) n = n.parent;
    expect(n ? flat(n.props.style).opacity : null).toBe(0);
    r.unmount();
  });
});

describe('Reduce Motion', () => {
  // A fresh motion module per test (its store is module-level). The store
  // starts listening on its FIRST read, and react-native's lazy getters only
  // resolve to the isolated registry while isolateModules is running, so that
  // first read happens inside it; later reads use the stored value.
  it('native: once the OS says on, web motion and layoutNext go quiet', async () => {
    let m!: typeof import('@/components/ui/motion');
    jest.isolateModules(() => {
      const rn = require('react-native');
      jest.spyOn(rn.AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
      m = require('@/components/ui/motion');
      expect(m.reducedMotion()).toBe(false); // the OS has not answered yet
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(m.reducedMotion()).toBe(true);
    const spy = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {});
    m.layoutNext();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    web();
    expect(m.webMotion('fadeIn')).toBeNull();
    expect(m.registerWithMotion({ borderRadius: 4 }, 'popIn')).toEqual({ borderRadius: 4 });
  });

  it('web: reads prefers-reduced-motion through matchMedia, never RN-web AccessibilityInfo', () => {
    const g = globalThis as unknown as { window?: { matchMedia?: (q: string) => unknown } };
    const hadWindow = 'window' in g;
    const prev = g.window;
    const queries: string[] = [];
    g.window = { ...(prev ?? {}), matchMedia: (q: string) => { queries.push(q); return { matches: true, addEventListener: () => {} }; } };
    try {
      let m!: typeof import('@/components/ui/motion');
      let asked = 0;
      jest.isolateModules(() => {
        const rn = require('react-native');
        jest.replaceProperty(rn.Platform, 'OS', 'web');
        jest.spyOn(rn.AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => { asked += 1; return Promise.resolve(false); });
        m = require('@/components/ui/motion');
        expect(m.reducedMotion()).toBe(true);
      });
      expect(queries).toEqual(['(prefers-reduced-motion: reduce)']);
      expect(asked).toBe(0);
      web();
      expect(m.webMotion('popIn')).toBeNull();
    } finally {
      if (hadWindow) g.window = prev; else delete g.window;
    }
  });
});
