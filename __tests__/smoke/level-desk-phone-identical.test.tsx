/**
 * Smoke — THE PHONE-UNCHANGED PROOF for lane LOADERDESK (the Level composed for
 * laptops and monitors).
 *
 * The large-screen loaders are an ADDITIVE override: every native platform at
 * any width, and the web below 768 px, must render exactly what it rendered
 * before. This file was written and its .snap RECORDED on the untouched base
 * (c5cf89fb), before any implementation line; the implementation must pass it
 * with `--ci` (no snapshot writes).
 *
 *   native  ios 393×852, ios 1366×1024 (an iPad-sized window is still 'phone'),
 *           android 1280×800 (a Chromebook / tablet app is still 'phone'):
 *           BrandSplash (live={false}, frame 0), BootShell, ScreenLoader with no
 *           caption and with "Loading" — toJSON(), whole.
 *   web     390×844 and 767×1024: ScreenLoader (both captions) — toJSON(),
 *           whole. BrandSplash and BootShell on the web carry ONE named delta,
 *           the orchestrator's decision that the web launch is the green brand
 *           (concrete ground, brand-green level) instead of the orange native
 *           PNG, so their web cases snapshot GEOMETRY only (every testID'd box:
 *           the mark rect, the level box, its track and bubble), which must not
 *           move by a pixel below 768.
 * Each under Reduce Motion off and on.
 *
 * ONE NAMED DELTA SINCE (2026-10-04, the founder: "after logging in the loading
 * screen is a very small level"): ScreenLoader's level is no longer the fixed
 * 64 pt — it is drawn at the launch mark's width for the window
 * (utils/levelDesk screenLevelW: 168 at 393, 438 on the 1366×1024 window, 342
 * on 1280×800, 167 on the 390 web, 240 on the 767 web). The 20 ScreenLoader
 * snapshots were re-recorded for that and nothing else (the level's box and
 * its parts; the ground, the caption and the a11y props are unchanged); the
 * BrandSplash and BootShell snapshots are the c5cf89fb recordings, untouched.
 *
 * Clocks pinned: fake timers, Date.now at the web level epoch (the CSS phase is
 * read from it), so nothing in a snapshot depends on when the suite runs.
 */

import React from 'react';
import { AccessibilityInfo, Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { act, cleanupAsync, render, type RenderAPI } from '@testing-library/react-native';

let mockReduce = false;
jest.mock('@/components/ui/motion', () => {
  const actual = jest.requireActual('@/components/ui/motion');
  return { ...actual, useReducedMotion: () => mockReduce, reducedMotion: () => mockReduce };
});

// eslint-disable-next-line import/first
import BrandSplash from '@/components/BrandSplash';
// eslint-disable-next-line import/first
import BootShell from '@/components/loaders/BootShell';
// eslint-disable-next-line import/first
import ScreenLoader from '@/components/loaders/ScreenLoader';
// eslint-disable-next-line import/first
import { __resetLaunchCurtainForTests } from '@/components/launch/launchCurtain';
// eslint-disable-next-line import/first
import { __resetSplashStageForTests } from '@/components/launch/splashStage';
// eslint-disable-next-line import/first
import { LEVEL_WEB_EPOCH_MS } from '@/components/loaders/css/levelCss';

type OS = 'ios' | 'android' | 'web';
type Screen = { os: OS; w: number; h: number; scale: number };

const NATIVE: Screen[] = [
  { os: 'ios', w: 393, h: 852, scale: 3 },
  { os: 'ios', w: 1366, h: 1024, scale: 2 },
  { os: 'android', w: 1280, h: 800, scale: 2 },
];
const WEB_PHONE: Screen[] = [
  { os: 'web', w: 390, h: 844, scale: 2 },
  { os: 'web', w: 767, h: 1024, scale: 2 },
];

const H = { includeHiddenElements: true } as const;
const flat = (s: unknown) => (StyleSheet.flatten(s as StyleProp<ViewStyle>) ?? {}) as Record<string, unknown>;

let restoreOS: (() => void) | null = null;
let probeSpy: jest.SpyInstance | null = null;
let nowSpy: jest.SpyInstance | null = null;
let savedDims: { window: ReturnType<typeof Dimensions.get>; screen: ReturnType<typeof Dimensions.get> } | null = null;

function env({ os, w, h, scale }: Screen, reduce: boolean) {
  restoreOS?.();
  restoreOS = os === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', os).restore;
  mockReduce = reduce;
  const d = { width: w, height: h, scale, fontScale: 1 };
  (Dimensions as unknown as { set: (x: object) => void }).set({ window: d, screen: d });
}

/** Let BrandSplash's reduce-motion probe resolve (a microtask), no clock movement. */
const flushProbe = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };

const label = (s: Screen, reduce: boolean) => `${s.os} ${s.w}x${s.h} RM ${reduce ? 'on' : 'off'}`;

/** Every testID'd box in the tree: position and size only (no colour). */
function geometry(r: RenderAPI, ids: string[]): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const id of ids) {
    const nodes = r.queryAllByTestId(id, H);
    nodes.forEach((n, i) => {
      const st = flat(n.props.style);
      out[nodes.length > 1 ? `${id}#${i}` : id] = {
        position: st.position, left: st.left, top: st.top, width: st.width, height: st.height,
        borderRadius: st.borderRadius,
      };
    });
  }
  return out;
}

// The hooks live INSIDE this describe so they run BEFORE the harness's root
// afterEach (its synchronous RNTL cleanup()): every tree is unmounted here,
// awaited and in order, so no act scope is left open across tests
// (loader-platform.test.tsx explains the swallowed-render failure that avoids).
describe('the phone renders what it rendered on c5cf89fb', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(LEVEL_WEB_EPOCH_MS);
    probeSpy = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(mockReduce));
    savedDims = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
  });

  afterEach(async () => {
    restoreOS?.();
    restoreOS = null;
    probeSpy?.mockRestore();
    probeSpy = null;
    nowSpy?.mockRestore();
    nowSpy = null;
    mockReduce = false;
    // Real timers BEFORE the async cleanup (level-launch's order): RNTL's async
    // unmount flushes on a setImmediate a fake clock would never run.
    jest.useRealTimers();
    await cleanupAsync();
    if (savedDims) (Dimensions as unknown as { set: (x: object) => void }).set(savedDims);
    savedDims = null;
    __resetLaunchCurtainForTests();
    __resetSplashStageForTests();
  });

  describe.each([false, true])('Reduce Motion %s', (reduce) => {
    describe.each(NATIVE)('native $os $w x $h', (screen) => {
      it('BrandSplash frame 0 (live={false})', async () => {
        env(screen, reduce);
        const r = render(<BrandSplash onDone={() => {}} live={false} />);
        await flushProbe();
        expect(r.toJSON()).toMatchSnapshot(`BrandSplash ${label(screen, reduce)}`);
        r.unmount();
      });

      it('BootShell', () => {
        env(screen, reduce);
        const r = render(<BootShell />);
        expect(r.toJSON()).toMatchSnapshot(`BootShell ${label(screen, reduce)}`);
        r.unmount();
      });

      it('ScreenLoader, no caption and caption "Loading"', () => {
        env(screen, reduce);
        const a = render(<ScreenLoader />);
        expect(a.toJSON()).toMatchSnapshot(`ScreenLoader ${label(screen, reduce)}`);
        a.unmount();
        const b = render(<ScreenLoader caption="Loading" />);
        expect(b.toJSON()).toMatchSnapshot(`ScreenLoader caption ${label(screen, reduce)}`);
        b.unmount();
      });
    });

    describe.each(WEB_PHONE)('web phone $w x $h', (screen) => {
      it('ScreenLoader, no caption and caption "Loading" (whole tree)', () => {
        env(screen, reduce);
        const a = render(<ScreenLoader />);
        expect(a.toJSON()).toMatchSnapshot(`ScreenLoader ${label(screen, reduce)}`);
        a.unmount();
        const b = render(<ScreenLoader caption="Loading" />);
        expect(b.toJSON()).toMatchSnapshot(`ScreenLoader caption ${label(screen, reduce)}`);
        b.unmount();
      });

      it('BrandSplash and BootShell: geometry only (the web launch palette is the named delta)', async () => {
        env(screen, reduce);
        const ids = ['level-mark', 'level-mark-track', 'level-mark-bubble'];
        const s = render(<BrandSplash onDone={() => {}} live={false} />);
        await flushProbe();
        expect(geometry(s, ['brand-splash-mark', ...ids])).toMatchSnapshot(`BrandSplash geometry ${label(screen, reduce)}`);
        s.unmount();
        const b = render(<BootShell />);
        expect(geometry(b, ['boot-shell-mark', ...ids])).toMatchSnapshot(`BootShell geometry ${label(screen, reduce)}`);
        b.unmount();
      });
    });
  });
});
