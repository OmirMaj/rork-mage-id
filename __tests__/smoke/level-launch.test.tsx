/**
 * Smoke — the cold start CONTINUES the native splash (lane LAUNCH).
 *
 * THE PROMISES THIS PROVES (assertions only, no snapshot):
 *  - Frame 0: BrandSplash draws the splash level at the native splash's exact
 *    rect on its FIRST render (before the reduce-motion probe answers); no
 *    wordmark; never a bare-ink-only frame.
 *  - Fast boot (ready at 100 ms): the exit starts at 100 + TARGET_GRACE_MS, a
 *    280 ms dissolve, onDone inside [380, 580] ms; the bubble never moved.
 *  - Slow boot, signed in: alive + wordmark by 600 ms; ready at 2000 →
 *    'lifting' → 'landed' → onDone within EXIT_MS + 50 of the exit start.
 *  - The 8 s failsafe; the 500 ms readiness backstop (a missed notify).
 *  - The BootShell → BrandSplash hand-off: BootShell is a still replica while
 *    the splash plays and ADOPTS its stage on the failsafe (amp 1 at once, the
 *    wordmark at rest, the shared clock never restarted).
 *  - Reduce Motion (splash + BootShell): nothing moves; 'lifting' never set.
 *  - ReloadVeil: the plain level (ScreenLoader), the grace and the 500 ms hold.
 *  - No haptic, ever.
 *
 * NO ThemeContext mock and NO ThemeProvider in this file: BrandSplash really
 * renders outside the provider (app/_layout.tsx), so this is the test that
 * proves nothing in its tree dereferences useTheme().
 *
 * The window: Dimensions.set to a 393 × 852 phone (what useWindowDimensions
 * reads), the same honest mechanism loader-platform.test.tsx uses.
 *
 * Reading amp: every host passes its amp Animated.Value to LevelMark as a
 * prop, so the tests read the value itself off the LevelMark element
 * (UNSAFE_getByType) — not a proxy through the clock-dependent transform.
 */

import React, { useState } from 'react';
import { AccessibilityInfo, Animated, Dimensions, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { act, cleanupAsync, render, within, type RenderAPI } from '@testing-library/react-native';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// Two test seams in motion.ts, both honest:
//  - Reduce Motion is read from mockReduce (the splash's own probe is the
//    AccessibilityInfo spy below);
//  - nativeDriver is FALSE here. Under jest the native driver never steps a
//    value and reports its end at once, so timings could not be observed at
//    all. JS-driven, the same Animated.timing calls (same durations, same
//    plateau easings) advance frame by frame on the fake clock, so the
//    timeline itself is what these tests measure. The driver flag is the only
//    thing that differs from the device.
let mockReduce = false;
jest.mock('@/components/ui/motion', () => {
  const actual = jest.requireActual('@/components/ui/motion');
  return { ...actual, nativeDriver: false, useReducedMotion: () => mockReduce, reducedMotion: () => mockReduce };
});

// eslint-disable-next-line import/first
import * as Haptics from 'expo-haptics';
// eslint-disable-next-line import/first
import BrandSplash, { SPLASH_MAX_LIFETIME_MS } from '@/components/BrandSplash';
// eslint-disable-next-line import/first
import BootShell from '@/components/loaders/BootShell';
// eslint-disable-next-line import/first
import LevelMark from '@/components/loaders/LevelMark';
// eslint-disable-next-line import/first
import ReloadVeil from '@/components/launch/ReloadVeil';
// eslint-disable-next-line import/first
import { levelClockStats } from '@/components/loaders/levelClock';
// eslint-disable-next-line import/first
import {
  __resetLaunchCurtainForTests, getLaunchPhase, setBootReady, subscribeLaunch, type LaunchPhase,
} from '@/components/launch/launchCurtain';
// eslint-disable-next-line import/first
import { __resetSplashStageForTests, getSplashStage, setSplashStage } from '@/components/launch/splashStage';
// eslint-disable-next-line import/first
import { LOADER, NATIVE_SPLASH_ACCENT } from '@/utils/levelTimeline';
// eslint-disable-next-line import/first
import { BRAND_ACCENT_ON_DARK } from '@/constants/colors';

const H = { includeHiddenElements: true } as const;
const TARGET_GRACE_MS = 150;
const EXIT_MS = 520;
const flat = (s: unknown) => (StyleSheet.flatten(s as StyleProp<ViewStyle>) ?? {}) as Record<string, unknown>;
const val = (v: unknown): number => (typeof v === 'number' ? v : (v as { __getValue(): number }).__getValue());
const WORDMARK = 'MAGE ID';

let savedDims: { window: ReturnType<typeof Dimensions.get>; screen: ReturnType<typeof Dimensions.get> } | null = null;
let probeSpy: jest.SpyInstance;
let phases: LaunchPhase[] = [];
let offPhases: (() => void) | null = null;

beforeEach(() => {
  jest.useFakeTimers();
  mockReduce = false;
  probeSpy = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(mockReduce));
  savedDims = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
  const d = { width: 393, height: 852, scale: 3, fontScale: 1 };
  (Dimensions as unknown as { set: (x: object) => void }).set({ window: d, screen: d });
  phases = [];
  offPhases = subscribeLaunch(() => {
    const p = getLaunchPhase();
    if (phases[phases.length - 1] !== p) phases.push(p);
  });
});

afterEach(async () => {
  offPhases?.();
  offPhases = null;
  probeSpy.mockRestore();
  jest.useRealTimers();
  await cleanupAsync();
  if (savedDims) (Dimensions as unknown as { set: (x: object) => void }).set(savedDims);
  savedDims = null;
  mockReduce = false;
  __resetLaunchCurtainForTests();
  __resetSplashStageForTests();
  (Haptics.impactAsync as jest.Mock).mockClear();
  (Haptics.notificationAsync as jest.Mock).mockClear();
});

const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });
/** Let the reduce-motion probe's promise resolve (a microtask) without moving the clock. */
const flushProbe = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };

/** The amp / props of the LevelMark inside a host testID. */
function markIn(r: RenderAPI, hostId: string) {
  return within(r.getByTestId(hostId, H)).UNSAFE_getByType(LevelMark).props as {
    amp: Animated.Value; animate?: boolean; hueColor?: string;
  };
}

function expectNoHaptics() {
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
}

describe('BrandSplash — frame 0', () => {
  it('draws the splash level at the native rect on its FIRST render, before the probe answers; no wordmark', () => {
    let firstRenderMark = false;
    const onDone = jest.fn();
    const r = render(<BrandSplash onDone={onDone} />);
    // Nothing has flushed: the probe promise is still pending.
    firstRenderMark = r.queryByTestId('level-mark', H) != null;
    expect(firstRenderMark).toBe(true);
    const box = flat(r.getByTestId('brand-splash-mark', H).props.style);
    expect(Math.abs((box.left as number) - 112.45)).toBeLessThan(0.5);
    expect(Math.abs((box.top as number) - 420.2)).toBeLessThan(0.5);
    expect(Math.abs((box.width as number) - 168.1)).toBeLessThan(0.5);
    expect(r.UNSAFE_queryAllByType(Text)).toHaveLength(0);
    // Still frame (amp 0) with the clock held while the probe is pending.
    const m = markIn(r, 'brand-splash');
    expect(m.animate).toBe(true);
    expect(val(m.amp)).toBe(0);
    // Frame 0 is the native splash replica (NATIVE_SPLASH_*). Build 18 bakes
    // the splash in the dark-theme brand green, so on the default brand the
    // live hue IS the baked accent and no hue layer renders (builds 1-17 baked
    // orange and needed one).
    expect(NATIVE_SPLASH_ACCENT).toBe(BRAND_ACCENT_ON_DARK);
    expect(m.hueColor).toBeUndefined();
    // The ink is its own layer under the level, the overlay itself paints nothing.
    expect(flat(r.getByTestId('brand-splash', H).props.style).backgroundColor).toBeUndefined();
    expectNoHaptics();
  });

  it('live={false}: frame 0 only — no timeline, no exit, even when the app is ready', async () => {
    const onDone = jest.fn();
    const r = render(<BrandSplash onDone={onDone} live={false} />);
    await flushProbe();
    act(() => { setBootReady(true); });
    advance(1500);
    expect(onDone).not.toHaveBeenCalled();
    expect(r.UNSAFE_queryAllByType(Text)).toHaveLength(0);
    expect(getSplashStage().alive).toBe(false);
    // Going live starts t = 0 there: ready → grace → the fast dissolve.
    r.rerender(<BrandSplash onDone={onDone} live />);
    advance(TARGET_GRACE_MS + LOADER.splash.exit.fastInkMs + 60);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('onFirstFrame fires once, after the first layout and one animation frame', () => {
    const onFirstFrame = jest.fn();
    const r = render(<BrandSplash onDone={() => {}} live={false} onFirstFrame={onFirstFrame} />);
    const root = r.getByTestId('brand-splash', H);
    act(() => { root.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 393, height: 852 } } }); });
    expect(onFirstFrame).not.toHaveBeenCalled();
    advance(20);
    expect(onFirstFrame).toHaveBeenCalledTimes(1);
    act(() => { root.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 393, height: 852 } } }); });
    advance(20);
    expect(onFirstFrame).toHaveBeenCalledTimes(1);
  });
});

describe('BrandSplash — the hold and the exits', () => {
  it('fast boot: ready at 100 → exit at 250, a 280 ms dissolve, onDone in [380, 580]; the bubble never moved', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    const onDone = jest.fn();
    const r = render(<BrandSplash onDone={onDone} />);
    await flushProbe();
    const amp = markIn(r, 'brand-splash').amp;
    advance(100);
    act(() => { setBootReady(true); });
    advance(TARGET_GRACE_MS - 1);
    expect(phases).not.toContain('lifting');
    advance(1); // 250: the exit starts
    expect(phases).toEqual(expect.arrayContaining(['lifting', 'landed']));
    advance(379 - 250);
    expect(onDone).not.toHaveBeenCalled();
    for (let t = 379; t < 580; t += 20) {
      expect(val(amp)).toBe(0);
      advance(20);
    }
    advance(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    // ONE honest assertion that the bubble never moved: every timing ever
    // started on this amp toward 1 was a PLATEAU (still 0 at x = 0.4, i.e.
    // before ALIVE), it was stopped before it left 0, and the stage never
    // reported 'alive'.
    const ampToOne = timing.mock.calls.filter((c) => c[0] === amp && (c[1] as { toValue: number }).toValue === 1);
    for (const c of ampToOne) expect((c[1] as { easing: (x: number) => number }).easing(0.4)).toBe(0);
    expect(val(amp)).toBe(0);
    expect(getSplashStage().alive).toBe(false);
    expect(getSplashStage().finished).toBe(true);
    timing.mockRestore();
    expectNoHaptics();
  });

  it('ready at 350 (inside ALIVE, the exit after it): the grace does not let the bubble start — still image, fast dissolve', async () => {
    const onDone = jest.fn();
    const r = render(<BrandSplash onDone={onDone} />);
    await flushProbe();
    const amp = markIn(r, 'brand-splash').amp;
    advance(350);
    act(() => { setBootReady(true); });
    for (let t = 350; t < 500; t += 25) {
      advance(25);
      expect(val(amp)).toBe(0);
    }
    expect(getSplashStage().alive).toBe(false);
    advance(LOADER.splash.exit.fastInkMs + 50); // 500 + 280 + 50
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(getSplashStage().alive).toBe(false);
    expect(val(amp)).toBe(0);
  });

  it('slow boot (signed in): alive + wordmark by 600; ready at 2000 → lifting → landed → onDone within EXIT_MS + 50', async () => {
    const onDone = jest.fn();
    const r = render(<BrandSplash onDone={onDone} />);
    await flushProbe();
    const amp = markIn(r, 'brand-splash').amp;
    advance(399);
    expect(getSplashStage().alive).toBe(false);
    expect(val(amp)).toBe(0);
    advance(1);
    expect(getSplashStage().alive).toBe(true);
    advance(200); // 600
    expect(r.getByText(WORDMARK)).toBeTruthy();
    expect(getSplashStage().wordmark).toBe(true);
    // The wordmark box: its bottom 28 pt above the level's vertical centre.
    const mark = flat(r.getByTestId('brand-splash-mark', H).props.style);
    const wmBox = flat(r.getByTestId('brand-splash-wordmark', H).props.style);
    expect(Math.abs((wmBox.top as number) + 32 - ((mark.top as number) + (mark.height as number) / 2 - 28))).toBeLessThan(0.01);
    advance(1400); // 2000: fully alive
    expect(val(amp)).toBe(1);
    act(() => { setBootReady(true); });
    advance(TARGET_GRACE_MS); // 2150: the exit starts
    expect(phases[phases.length - 1]).toBe('lifting');
    advance(LOADER.splash.exit.inkAtMs);
    expect(phases[phases.length - 1]).toBe('landed');
    advance(EXIT_MS + 50 - LOADER.splash.exit.inkAtMs);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(val(amp)).toBe(0); // settled dead centre
    expectNoHaptics();
  });

  it('the failsafe: never ready → onDone at 8000, not before 7999', async () => {
    expect(SPLASH_MAX_LIFETIME_MS).toBe(8000);
    const onDone = jest.fn();
    render(<BrandSplash onDone={onDone} />);
    await flushProbe();
    advance(7999);
    expect(onDone).not.toHaveBeenCalled();
    advance(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    // hue: false — the default live brand is the baked green accent.
    expect(getSplashStage()).toEqual({ alive: true, wordmark: true, hue: false, finished: true });
    expect(getLaunchPhase()).toBe('open');
  });

  it('the backstop: ready flipped with NO notify reaching the splash → it still exits on the 500 ms interval', async () => {
    const onDone = jest.fn();
    render(<BrandSplash onDone={onDone} />);
    await flushProbe();
    advance(1000);
    // Drop every launch listener (the splash's subscription included), then
    // flip readiness: the notify reaches nobody — a missed notify.
    act(() => { __resetLaunchCurtainForTests(); setBootReady(true); });
    advance(499); // 1499: the interval has not ticked since the flip
    expect(onDone).not.toHaveBeenCalled();
    advance(1 + TARGET_GRACE_MS + EXIT_MS + 50); // tick at 1500 → grace → exit → bounded end
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('Reduce Motion: a still frame (no clock, no transform), a 200 ms fade on ready, never lifting', async () => {
    mockReduce = true;
    const before = levelClockStats();
    const onDone = jest.fn();
    const r = render(<BrandSplash onDone={onDone} />);
    await flushProbe();
    const m = markIn(r, 'brand-splash');
    expect(m.animate).toBe(false);
    for (const step of [0, 500, 500]) {
      if (step) advance(step);
      expect(flat(r.getByTestId('level-mark-bubble', H).props.style).transform).toBeUndefined();
    }
    const s = levelClockStats();
    expect(s.count).toBe(0);
    expect(s.rmCount).toBe(0);
    expect(s.starts).toBe(before.starts);
    act(() => { setBootReady(true); }); // 1000
    advance(TARGET_GRACE_MS + LOADER.splash.exit.rmInkMs - 1);
    expect(onDone).not.toHaveBeenCalled();
    advance(60);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(phases).not.toContain('lifting');
    expect(getSplashStage().alive).toBe(false);
    expectNoHaptics();
  });
});

describe('BootShell → BrandSplash hand-off', () => {
  function Host({ splash }: { splash: boolean }) {
    const [done, setDone] = useState(false);
    return (
      <View style={{ flex: 1 }}>
        <BootShell />
        {splash && !done && <BrandSplash onDone={() => setDone(true)} />}
      </View>
    );
  }

  it('a still replica while the splash plays; on the failsafe it ADOPTS the stage in the same act, clock never restarted', async () => {
    const before = levelClockStats();
    const r = render(<Host splash={false} />);
    await flushProbe();
    advance(1000);
    expect(r.UNSAFE_queryAllByType(Text)).toHaveLength(0);
    const bootAmp = markIn(r, 'boot-shell').amp;
    expect(val(bootAmp)).toBe(0);
    expect(levelClockStats().count).toBe(1);
    expect(levelClockStats().starts - before.starts).toBe(1);

    r.rerender(<Host splash />); // BrandSplash mounts beside it (t = 1000)
    await flushProbe();
    advance(1000); // 2000: the splash is alive and shows its wordmark
    expect(val(markIn(r, 'brand-splash').amp)).toBe(1);
    expect(within(r.getByTestId('brand-splash', H)).getByText(WORDMARK)).toBeTruthy();
    expect(getSplashStage()).toEqual({ alive: true, wordmark: true, hue: false, finished: false });
    // BootShell is still the still replica: no wordmark, amp 0.
    expect(r.queryByTestId('boot-shell-wordmark', H)).toBeNull();
    expect(val(bootAmp)).toBe(0);
    expect(levelClockStats().count).toBe(2);

    const timing = jest.spyOn(Animated, 'timing');
    advance(SPLASH_MAX_LIFETIME_MS - 1000); // 9000: the splash's failsafe → onDone → unmounted
    expect(r.queryByTestId('brand-splash', H)).toBeNull();
    // Adopted at once: amp 1 with no timing on it, the wordmark at rest.
    expect(val(bootAmp)).toBe(1);
    expect(timing.mock.calls.some((c) => c[0] === bootAmp)).toBe(false);
    const wm = flat(r.getByTestId('boot-shell-wordmark', H).props.style);
    expect(val(wm.opacity)).toBe(1);
    expect(val((wm.transform as { translateY: unknown }[])[0].translateY)).toBe(0);
    timing.mockRestore();
    // The shared clock: one holder left, never stopped or restarted across the swap.
    expect(levelClockStats().count).toBe(1);
    expect(levelClockStats().starts - before.starts).toBe(1);
    expect(levelClockStats().stops).toBe(before.stops);
  });

  it('BootShell alone never comes alive on its own clock (no timers, no wordmark)', () => {
    const r = render(<BootShell />);
    advance(10_000);
    expect(val(markIn(r, 'boot-shell').amp)).toBe(0);
    expect(r.UNSAFE_queryAllByType(Text)).toHaveLength(0);
  });

  it('finished while the app IS ready: nothing is adopted', () => {
    const r = render(<BootShell />);
    act(() => { setBootReady(true); setSplashStage({ alive: true, wordmark: true, finished: true }); });
    expect(val(markIn(r, 'boot-shell').amp)).toBe(0);
    expect(r.queryByTestId('boot-shell-wordmark', H)).toBeNull();
  });

  it('adopting a splash that never came alive: the drift starts from 0, the wordmark rises in at +500', () => {
    const r = render(<BootShell />);
    const timing = jest.spyOn(Animated, 'timing');
    act(() => { setSplashStage({ finished: true }); });
    const amp = markIn(r, 'boot-shell').amp;
    const ampCall = timing.mock.calls.find((c) => c[0] === amp);
    expect(ampCall?.[1]).toMatchObject({ toValue: 1, duration: LOADER.splash.ampDriftMs });
    const wm = () => flat(r.getByTestId('boot-shell-wordmark', H).props.style);
    expect(val(wm().opacity)).toBe(0);
    advance(LOADER.splash.wordmarkAtMs - 10);
    expect(val(wm().opacity)).toBe(0);
    advance(LOADER.splash.wordmarkMs + 60);
    expect(val(wm().opacity)).toBe(1);
    timing.mockRestore();
  });

  it('BootShell under Reduce Motion: no clock, no transform; an adopted wordmark shows without translate', () => {
    mockReduce = true;
    const before = levelClockStats();
    const r = render(<BootShell />);
    expect(flat(r.getByTestId('level-mark-bubble', H).props.style).transform).toBeUndefined();
    expect(levelClockStats().count).toBe(0);
    expect(levelClockStats().rmCount).toBe(0);
    act(() => { setSplashStage({ finished: true }); });
    advance(LOADER.splash.wordmarkAtMs + LOADER.splash.wordmarkMs + 20);
    const wm = flat(r.getByTestId('boot-shell-wordmark', H).props.style);
    expect(val(wm.opacity)).toBe(1);
    expect(val((wm.transform as { translateY: unknown }[])[0].translateY)).toBe(0);
    expect(val(markIn(r, 'boot-shell').amp)).toBe(0);
    expect(flat(r.getByTestId('level-mark-bubble', H).props.style).transform).toBeUndefined();
    expect(levelClockStats().starts).toBe(before.starts);
  });
});

describe('ReloadVeil — the plain level, the grace, the hold', () => {
  const opacityOf = (r: RenderAPI): number | null => {
    const veil = r.queryByTestId('root-nav-reload-overlay');
    if (!veil) return null;
    const o = flat((veil.children[0] as { props: { style: unknown } }).props.style).opacity;
    return typeof o === 'number' ? o : val(o);
  };

  it('active for 150 ms → never visible', () => {
    const r = render(<ReloadVeil active />);
    expect(opacityOf(r)).toBe(0);
    advance(150);
    expect(opacityOf(r)).toBe(0);
    r.rerender(<ReloadVeil active={false} />);
    expect(r.queryByTestId('root-nav-reload-overlay')).toBeNull();
    advance(1000);
    expect(r.queryByTestId('root-nav-reload-overlay')).toBeNull();
  });

  it('active for 300 ms → visible by 380, held until 700 (shown at 200 + 500), then fades and unmounts', () => {
    const r = render(<ReloadVeil active />);
    expect(r.getByTestId('screen-loader')).toBeTruthy();
    expect(r.queryByTestId('crane-loader')).toBeNull();
    expect(r.queryByTestId('root-nav-reload-overlay')!.props.pointerEvents).toBe('auto');
    advance(300);
    r.rerender(<ReloadVeil active={false} />);
    // Input is released at once; only the picture holds.
    expect(r.queryByTestId('root-nav-reload-overlay')!.props.pointerEvents).toBe('none');
    advance(80); // 380: the 160 ms fade-in (200 → 360) has landed on a frame
    expect(opacityOf(r)).toBe(1);
    advance(319); // 699
    expect(opacityOf(r)).toBe(1);
    advance(1 + 90); // the fade started at 700
    const mid = opacityOf(r);
    expect(mid).not.toBeNull();
    expect(mid!).toBeLessThan(1);
    advance(200);
    expect(r.queryByTestId('root-nav-reload-overlay')).toBeNull();
    expect(opacityOf(r)).toBeNull();
  });

  it('re-activation during the hold cancels it (still visible, no second grace)', () => {
    const r = render(<ReloadVeil active />);
    advance(300);
    r.rerender(<ReloadVeil active={false} />);
    advance(200); // 500: inside the hold
    r.rerender(<ReloadVeil active />);
    advance(1000);
    expect(opacityOf(r)).toBe(1);
    expect(r.queryByTestId('root-nav-reload-overlay')!.props.pointerEvents).toBe('auto');
  });
});
