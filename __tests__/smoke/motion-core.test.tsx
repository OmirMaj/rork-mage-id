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
import { LayoutAnimation, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  Button,
  layoutNext,
  registerWithMotion,
  useRiseOnOpen,
  useSheetFrame,
  useSwapFade,
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

  it('phone: loading still swaps the label for the spinner (the pre-change tree)', () => {
    const r = render(
      <Wrap>
        <Button label="Save" onPress={() => {}} loading />
      </Wrap>,
    );
    expect(r.queryByText('Save')).toBeNull();
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
