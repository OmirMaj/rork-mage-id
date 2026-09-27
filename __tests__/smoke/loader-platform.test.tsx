/**
 * Smoke — "The Level" loading system (lane CORE).
 *
 * THE PROMISES THIS PROVES (plain assertions, no snapshot):
 *  - CraneSvg keeps its box (size × size·300/340) and centres a LevelMark on
 *    native (288 → 120, 180 → 108, 28 → 28), no Svg; on the web (Platform.OS
 *    flipped at runtime) the SVG crane from 120 px, the level below.
 *  - The mark: static when animate={false} (no clock); animating → the bubble
 *    transform is exactly translateX, scaleX, scaleY; Reduce Motion → an
 *    animated opacity and no translateX; N marks share ONE clock start / stop.
 *  - ConstructionLoader sm/md/lg → 20/36/64; labels are honest (labels[0]
 *    only, a real elapsed clock after 8 s).
 *  - BootShell stub: the splash rect, no wordmark, amp pinned 0, holds the
 *    clock; Reduce Motion → a still frame.
 *  - CraneLoader 'MAGE ID' → BootShell before boot, ScreenLoader after.
 *  - <Loading>: cached → children only; fast → no loader, no Arrive; slow →
 *    held, then settled away; render-function children never run early.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { act, cleanupAsync, render, within } from '@testing-library/react-native';
import Svg from 'react-native-svg';
import CraneLoader, { CraneSvg } from '@/components/CraneLoader';
import ConstructionLoader from '@/components/ConstructionLoader';
import LevelMark from '@/components/loaders/LevelMark';
import BootShell from '@/components/loaders/BootShell';
import Loading from '@/components/loaders/Loading';
import { levelClockStats } from '@/components/loaders/levelClock';
import { __resetLaunchCurtainForTests, setBootReady } from '@/components/launch/launchCurtain';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});

let mockReduce = false;
jest.mock('@/components/ui/motion', () => {
  const actual = jest.requireActual('@/components/ui/motion');
  return { ...actual, useReducedMotion: () => mockReduce };
});

describe('The Level', () => {
  // The harness's afterEach runs RNTL's SYNC cleanup(), which starts every
  // queued render's unmountAsync (an async act) in one synchronous loop. With two
  // or more renders in a test those acts overlap, React restores a stale act
  // queue, and every later render in the file is swallowed into it (it never
  // commits: "Can't access .root on unmounted test renderer"). These tests render
  // several trees each, so this block drains the queue itself with cleanupAsync()
  // (sequential, awaited) — inner-describe hooks run before the harness's.
  let restoreOS: (() => void) | null = null;
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(async () => {
    restoreOS?.();
    restoreOS = null;
    mockReduce = false;
    jest.useRealTimers();
    await cleanupAsync();
    __resetLaunchCurtainForTests();
  });
  const asWeb = () => { restoreOS = jest.replaceProperty(Platform, 'OS', 'web').restore; };
  // The mark is decorative (hidden from screen readers), so queries must opt in.
  const H = { includeHiddenElements: true } as const;
  const flat = (s: unknown) => (StyleSheet.flatten(s as StyleProp<ViewStyle>) ?? {}) as Record<string, unknown>;
  const transformKeys = (st: Record<string, unknown>) => ((st.transform as object[] | undefined) ?? []).map((o) => Object.keys(o));
  const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

  describe('CraneSvg', () => {
    it('native 288: the crane box, a 120-wide level inside, no Svg, decorative', () => {
      const r = render(<CraneSvg size={288} />);
      const box = r.getByTestId('crane-svg', H);
      expect(flat(box.props.style).width).toBe(288);
      expect(flat(box.props.style).height).toBeCloseTo((288 * 300) / 340, 6);
      const mark = within(box).getByTestId('level-mark', H);
      expect(flat(mark.props.style).width).toBe(120);
      expect(r.UNSAFE_queryAllByType(Svg)).toHaveLength(0);
      expect(mark.props.importantForAccessibility).toBe('no-hide-descendants');
      expect(mark.props.accessibilityElementsHidden).toBe(true);
      r.unmount();
    });

    it('native 180 → a 108 mark; 28 → a 28 mark in a 28 × 24.7 box', () => {
      const a = render(<CraneSvg size={180} />);
      expect(flat(a.getByTestId('level-mark', H).props.style).width).toBe(108);
      a.unmount();
      const b = render(<CraneSvg size={28} />);
      const box = flat(b.getByTestId('crane-svg', H).props.style);
      expect(box.width).toBe(28);
      expect(box.height).toBeCloseTo(24.7, 1);
      expect(flat(b.getByTestId('level-mark', H).props.style).width).toBe(28);
      b.unmount();
    });

    it('web (Platform.OS flipped at runtime): 288 → the composited crane (no svg), no level; 28 → the level, no crane', () => {
      asWeb();
      const a = render(<CraneSvg size={288} />);
      expect(a.getByTestId('crane-mark-web', H)).toBeTruthy();
      expect(a.UNSAFE_queryAllByType(Svg)).toHaveLength(0);
      expect(a.queryByTestId('level-mark', H)).toBeNull();
      a.unmount();
      const b = render(<CraneSvg size={28} />);
      expect(b.getByTestId('level-mark', H)).toBeTruthy();
      expect(b.queryByTestId('crane-mark-web', H)).toBeNull();
      expect(b.UNSAFE_queryAllByType(Svg)).toHaveLength(0);
      b.unmount();
    });
  });

  describe('LevelMark', () => {
    it('animate={false}: the bubble has no transform and no clock is subscribed', () => {
      const before = levelClockStats();
      const r = render(<CraneSvg size={180} animate={false} />);
      const st = flat(r.getByTestId('level-mark-bubble', H).props.style);
      expect(st.transform).toBeUndefined();
      const during = levelClockStats();
      expect(during.count).toBe(0);
      expect(during.starts).toBe(before.starts);
      r.unmount();
    });

    it('animating: the bubble transform is exactly translateX, scaleX, scaleY', () => {
      const r = render(<LevelMark size={120} />);
      const st = flat(r.getByTestId('level-mark-bubble', H).props.style);
      expect(transformKeys(st)).toEqual([['translateX'], ['scaleX'], ['scaleY']]);
      r.unmount();
    });

    it('Reduce Motion: an animated bubble opacity and NO translateX', () => {
      mockReduce = true;
      const r = render(<LevelMark size={120} />);
      const st = flat(r.getByTestId('level-mark-bubble', H).props.style);
      expect(typeof st.opacity).toBe('number');
      expect(transformKeys(st).flat()).not.toContain('translateX');
      expect(levelClockStats().rmCount).toBe(1);
      expect(levelClockStats().count).toBe(0);
      r.unmount();
      expect(levelClockStats().rmCount).toBe(0);
    });

    it('two marks share ONE clock: one start, and one stop after both unmount', () => {
      const before = levelClockStats();
      const a = render(<LevelMark size={36} />);
      const b = render(<LevelMark size={64} />);
      const during = levelClockStats();
      expect(during.count).toBe(2);
      expect(during.starts - before.starts).toBe(1);
      a.unmount();
      expect(levelClockStats().stops - before.stops).toBe(0);
      b.unmount();
      const after = levelClockStats();
      expect(after.count).toBe(0);
      expect(after.stops - before.stops).toBe(1);
    });
  });

  describe('ConstructionLoader', () => {
    it('sm/md/lg → level widths 20/36/64; label + accessibilityLabel preserved', () => {
      for (const [size, w] of [['sm', 20], ['md', 36], ['lg', 64]] as const) {
        const r = render(<ConstructionLoader size={size} label="Loading bid details..." />);
        expect(flat(r.getByTestId('level-mark', H).props.style).width).toBe(w);
        expect(r.getByTestId('construction-loader').props.accessibilityLabel).toBe('Loading bid details...');
        expect(r.getByText('Loading bid details...')).toBeTruthy();
        expect(r.UNSAFE_queryAllByType(Svg)).toHaveLength(0);
        r.unmount();
      }
    });

    it("labels are honest: 'A' at 0, 'A · 0:08' at 8 s, still stage A at 10 s (never B / C)", () => {
      const r = render(<ConstructionLoader size="lg" labels={['A', 'B', 'C']} />);
      expect(r.getByText('A')).toBeTruthy();
      advance(8000);
      expect(r.getByText('A · 0:08')).toBeTruthy();
      advance(2000);
      expect(r.getByText('A · 0:10')).toBeTruthy();
      expect(r.queryByText(/^B|^C/)).toBeNull();
      expect(r.getByTestId('construction-loader').props.accessibilityLabel).toBe('A');
      r.unmount();
    });

    it('web lg renders a level and no Svg', () => {
      asWeb();
      const r = render(<ConstructionLoader size="lg" />);
      expect(r.getByTestId('level-mark', H)).toBeTruthy();
      expect(r.UNSAFE_queryAllByType(Svg)).toHaveLength(0);
      r.unmount();
    });
  });

  describe('BootShell (static stub)', () => {
    // A 393 × 852 phone (iPhone 15/16), restored after each test.
    let saved: { window: ReturnType<typeof Dimensions.get>; screen: ReturnType<typeof Dimensions.get> } | null = null;
    const phone = () => {
      saved = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
      const d = { width: 393, height: 852, scale: 3, fontScale: 1 };
      act(() => { (Dimensions as unknown as { set: (x: object) => void }).set({ window: d, screen: d }); });
    };
    afterEach(() => {
      if (saved) (Dimensions as unknown as { set: (x: object) => void }).set(saved);
      saved = null;
    });

    it('sits at the splash rect, draws no wordmark, keeps amp 0, and holds the clock', () => {
      phone();
      const before = levelClockStats();
      const r = render(<BootShell />);
      const box = flat(r.getByTestId('boot-shell-mark', H).props.style);
      expect(box.left as number).toBeCloseTo(112.45, 0);
      expect(Math.abs((box.top as number) - 420.2)).toBeLessThan(0.5);
      expect(Math.abs((box.width as number) - 168.1)).toBeLessThan(0.5);
      for (const step of [0, 1000, 2000]) { // checked at 0, 1000 and 3000 ms
        if (step) advance(step);
        expect(r.UNSAFE_queryAllByType(Text)).toHaveLength(0);
        const st = flat(r.getByTestId('level-mark-bubble', H).props.style);
        expect(transformKeys(st)[0]).toEqual(['translateX']);
        expect((st.transform as Record<string, number>[])[0].translateX).toBe(0);
      }
      expect(levelClockStats().count).toBe(1);
      expect(levelClockStats().starts - before.starts).toBe(1);
      r.unmount();
      expect(levelClockStats().count).toBe(0);
    });

    it('Reduce Motion: no clock, no transform (a still frame)', () => {
      mockReduce = true;
      phone();
      const before = levelClockStats();
      const r = render(<BootShell />);
      const st = flat(r.getByTestId('level-mark-bubble', H).props.style);
      expect(st.transform).toBeUndefined();
      const s = levelClockStats();
      expect(s.count).toBe(0);
      expect(s.rmCount).toBe(0);
      expect(s.rmStarts).toBe(before.rmStarts);
      r.unmount();
    });
  });

  describe('CraneLoader', () => {
    it("'MAGE ID' → BootShell before the first boot, ScreenLoader after", () => {
      const a = render(<CraneLoader label="MAGE ID" />);
      expect(a.getByTestId('boot-shell')).toBeTruthy();
      expect(a.queryByTestId('screen-loader')).toBeNull();
      a.unmount();
      setBootReady(true);
      const b = render(<CraneLoader label="MAGE ID" />);
      expect(b.getByTestId('screen-loader')).toBeTruthy();
      expect(b.queryByTestId('boot-shell')).toBeNull();
      b.unmount();
    });

    it('a status label → crane-loader with a 17 pt status line and a 64-wide level', () => {
      const r = render(<CraneLoader label="Loading takeoff" />);
      expect(r.getByTestId('crane-loader')).toBeTruthy();
      expect(flat(r.getByText('Loading takeoff').props.style).fontSize).toBe(17);
      expect(flat(r.getByTestId('level-mark', H).props.style).width).toBe(64);
      r.unmount();
    });
  });

  describe('<Loading>', () => {
    it('ready at mount → the children only, no level', () => {
      const r = render(<Loading ready scope="screen"><Text>kid</Text></Loading>);
      expect(r.getByText('kid')).toBeTruthy();
      expect(r.queryByTestId('level-mark', H)).toBeNull();
      expect(r.queryByTestId('loading')).toBeNull();
      r.unmount();
    });

    it('ready at 100 ms (screen) → the loader unmounts, children appear with no Arrive style', () => {
      const r = render(<Loading ready={false} scope="screen"><Text>kid</Text></Loading>);
      expect(r.getByTestId('loading-screen')).toBeTruthy();
      advance(100);
      r.rerender(<Loading ready scope="screen"><Text>kid</Text></Loading>);
      expect(r.queryByTestId('loading-screen')).toBeNull();
      expect(r.queryByTestId('level-mark', H)).toBeNull();
      expect(r.getByText('kid')).toBeTruthy();
      const st = flat(r.getByTestId('loading-content').props.style);
      expect(st.opacity).toBeUndefined();
      expect(st.transform).toBeUndefined();
      r.unmount();
    });

    it('ready at 300 ms (screen) → still showing at 600 ms, gone after the hold + settle', () => {
      const kid = jest.fn(() => <Text>kid</Text>);
      const r = render(<Loading ready={false} scope="screen">{kid}</Loading>);
      advance(300);
      expect(kid).not.toHaveBeenCalled();
      r.rerender(<Loading ready scope="screen">{kid}</Loading>);
      advance(300);
      expect(r.getByTestId('loading-screen')).toBeTruthy();
      expect(r.queryByText('kid')).toBeNull();
      advance(400); // the 400 ms hold ends at 700: the settle starts
      expect(r.getByText('kid')).toBeTruthy(); // content arrives under the settling level
      advance(600); // settled (or backstopped at +340 + 150) → unmounted
      expect(r.queryByTestId('loading-screen')).toBeNull();
      expect(r.getByText('kid')).toBeTruthy();
      expect(kid).toHaveBeenCalled();
      r.unmount();
    });
  });
});
