/**
 * Slick round 3, lane A1 — the launch curtain, the login/signup entrance and
 * the sign-in reload veil, as units.
 *
 *  - components/launch/launchCurtain.ts: default 'open', the stale clock read,
 *    and the HEAL that NOTIFIES (so a subscribed screen re-renders even when
 *    the splash never finishes).
 *  - components/auth/authMotion.tsx useLaunchEntrance: unarmed at 'open' (the
 *    tree is unchanged), armed under the curtain, the wordmark hidden only
 *    until 'landed', and nothing left hidden by a heal or Reduce Motion.
 *  - components/launch/ReloadVeil.tsx: renders nothing until a reload, blocks
 *    input while active, lets go at once and fades out after it.
 */

import React from 'react';
import { AccessibilityInfo, Animated, Dimensions, Text, View, type ViewStyle } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

jest.mock('@/components/CraneLoader', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  return { __esModule: true, default: ({ label }: { label?: string }) => <RNText>{`crane:${label}`}</RNText> };
});

// Reduce Motion: motion.ts listens to the OS once, on its first read. Capture
// that listener so a test can flip the setting the way the OS would.
const reduceListeners: Array<(v: boolean) => void> = [];
jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((ev: string, fn: (v: boolean) => void) => {
  if (ev === 'reduceMotionChanged') reduceListeners.push(fn);
  return { remove() {} };
}) as never);

// eslint-disable-next-line import/first
import * as curtain from '@/components/launch/launchCurtain';
// eslint-disable-next-line import/first
import * as authMotion from '@/components/auth/authMotion';
// eslint-disable-next-line import/first
import ReloadVeil from '@/components/launch/ReloadVeil';
// eslint-disable-next-line import/first
import { reducedMotion } from '@/components/ui/motion';

type AuthMotion = typeof authMotion;
let now = 1_000_000;
let nowSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  now = 1_000_000;
  nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  Dimensions.set({
    window: { width: 390, height: 844, scale: 2, fontScale: 1 },
    screen: { width: 390, height: 844, scale: 2, fontScale: 1 },
  });
  curtain.__resetLaunchCurtainForTests();
});
afterEach(() => {
  nowSpy.mockRestore();
  jest.useRealTimers();
});

function advance(ms: number) {
  act(() => {
    now += ms;
    jest.advanceTimersByTime(ms);
  });
}

const value = (v: unknown) => (v as Animated.Value & { __getValue(): number }).__getValue();

describe('launchCurtain', () => {
  it('runs under jest with JEST_WORKER_ID set (BrandSplash’s module-scope guard relies on it)', () => {
    expect(process.env.JEST_WORKER_ID).toBeDefined();
  });

  it('defaults to open, with no target and boot not ready', () => {
    expect(curtain.getLaunchPhase()).toBe('open');
    expect(curtain.getLaunchTarget()).toBeNull();
    expect(curtain.getBootReady()).toBe(false);
  });

  it('ignores a zero-width or off-screen target, keeps a real one, and clears on null', () => {
    curtain.registerLaunchTarget({ x: 10, y: 10, width: 0, height: 12 });
    expect(curtain.getLaunchTarget()).toBeNull();
    curtain.registerLaunchTarget({ x: 500, y: 10, width: 60, height: 12 });
    expect(curtain.getLaunchTarget()).toBeNull();
    curtain.registerLaunchTarget({ x: 10, y: 900, width: 60, height: 12 });
    expect(curtain.getLaunchTarget()).toBeNull();
    const rect = { x: 68, y: 91, width: 64, height: 16 };
    curtain.registerLaunchTarget(rect);
    expect(curtain.getLaunchTarget()).toEqual(rect);
    curtain.registerLaunchTarget(null);
    expect(curtain.getLaunchTarget()).toBeNull();
  });

  it('setLaunchPhase notifies; setBootReady notifies only on a change', () => {
    const fn = jest.fn();
    const off = curtain.subscribeLaunch(fn);
    curtain.setLaunchPhase('covered');
    expect(fn).toHaveBeenCalledTimes(1);
    curtain.setBootReady(true);
    curtain.setBootReady(true);
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    curtain.setLaunchPhase('open');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('markLaunchPending covers; the clock read goes stale past LAUNCH_STALE_MS', () => {
    curtain.markLaunchPending();
    expect(curtain.getLaunchPhase()).toBe('covered');
    now += curtain.LAUNCH_STALE_MS + 1; // the timer has NOT fired (a stalled JS thread)
    expect(curtain.getLaunchPhase()).toBe('open');
  });

  it('THE HEAL NOTIFIES: a curtain nobody lifts reopens with a notification', () => {
    const fn = jest.fn();
    curtain.subscribeLaunch(fn);
    curtain.markLaunchPending();
    fn.mockClear();
    advance(curtain.LAUNCH_STALE_MS + 60);
    expect(fn).toHaveBeenCalled();
    now = 0; // defeat the clock read: the STORED phase must be open
    expect(curtain.getLaunchPhase()).toBe('open');
  });

  it("'open' clears the heal timer", () => {
    const fn = jest.fn();
    curtain.markLaunchPending();
    curtain.setLaunchPhase('open');
    curtain.subscribeLaunch(fn);
    advance(curtain.LAUNCH_STALE_MS + 60);
    expect(fn).not.toHaveBeenCalled();
  });
});

// ── useLaunchEntrance ──────────────────────────────────────────────────────
let last: ReturnType<AuthMotion['useLaunchEntrance']> | null = null;
function Probe() {
  const e = authMotion.useLaunchEntrance(3);
  last = e;
  const Slot = authMotion.Slot;
  return (
    <View>
      <Text testID="wordmark">{e.showWordmark ? 'shown' : 'hidden'}</Text>
      <Slot style={e.slot(0)}><Text testID="block0">block</Text></Slot>
    </View>
  );
}

describe('useLaunchEntrance', () => {
  it('is unarmed when mounted at open: slot null, wordmark shown, no wrapper', () => {
    render(<Probe />);
    expect(last!.armed).toBe(false);
    expect(last!.slot(0)).toBeNull();
    expect(last!.showWordmark).toBe(true);
    expect(screen.toJSON()).toMatchInlineSnapshot(`
<View>
  <Text
    testID="wordmark"
  >
    shown
  </Text>
  <Text
    testID="block0"
  >
    block
  </Text>
</View>
`);
  });

  it('arms under the curtain, shows the wordmark at landed, and rests at open', () => {
    curtain.markLaunchPending();
    render(<Probe />);
    expect(last!.armed).toBe(true);
    const s0 = last!.slot(0) as ViewStyle & { opacity: unknown; transform: Array<{ translateY: unknown }> };
    expect(s0).toBeTruthy();
    expect(value(s0.opacity)).toBe(0);
    expect(value(s0.transform[0].translateY)).toBe(12);
    expect(last!.slot(10)).toBeNull();
    expect(screen.getByTestId('wordmark').props.children).toBe('hidden');

    // 'lifting' starts the stagger: one rise spring per slot (Motion.spring.rise,
    // ζ≈0.96). The native driver does not step frames under jest, so the run is
    // proven by the calls, and the landing by an interruption (below).
    const spring = jest.spyOn(Animated, 'spring');
    act(() => { curtain.setLaunchPhase('lifting'); });
    expect(spring).toHaveBeenCalledTimes(3);
    expect(spring.mock.calls[0][1]).toMatchObject({ toValue: 0, damping: 31, stiffness: 260, mass: 1 });
    spring.mockRestore();
    expect(screen.getByTestId('wordmark').props.children).toBe('hidden');
    act(() => { curtain.setLaunchPhase('landed'); });
    expect(screen.getByTestId('wordmark').props.children).toBe('shown');
    act(() => { curtain.setLaunchPhase('open'); });
    expect(screen.getByTestId('wordmark').props.children).toBe('shown');
  });

  it('an interrupted stagger lands at rest, never part-way', () => {
    curtain.markLaunchPending();
    const r = render(<Probe />);
    const s0 = last!.slot(0) as ViewStyle & { opacity: unknown; transform: Array<{ translateY: unknown }> };
    act(() => { curtain.setLaunchPhase('lifting'); });
    advance(50);
    r.unmount();
    expect(value(s0.opacity)).toBe(1);
    expect(value(s0.transform[0].translateY)).toBe(0);
  });

  it("'open' before the stagger ran snaps every block to rest at once", () => {
    curtain.markLaunchPending();
    render(<Probe />);
    const s0 = last!.slot(0) as ViewStyle & { opacity: unknown; transform: Array<{ translateY: unknown }> };
    act(() => { curtain.setLaunchPhase('open'); });
    expect(value(s0.opacity)).toBe(1);
    expect(value(s0.transform[0].translateY)).toBe(0);
    expect(screen.getByTestId('wordmark').props.children).toBe('shown');
  });

  it('THE HEAL RE-RENDERS: armed and never lifted, only time passes → the wordmark shows', () => {
    curtain.markLaunchPending();
    render(<Probe />);
    const s0 = last!.slot(0) as ViewStyle & { opacity: unknown };
    expect(screen.getByTestId('wordmark').props.children).toBe('hidden');
    advance(curtain.LAUNCH_STALE_MS + 60);
    expect(screen.getByTestId('wordmark').props.children).toBe('shown');
    expect(value(s0.opacity)).toBe(1);
  });

  it('is unarmed under Reduce Motion', async () => {
    reducedMotion(); // the first read starts listening
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
    expect(reduceListeners.length).toBeGreaterThan(0);
    act(() => { reduceListeners.forEach((fn) => fn(true)); });
    try {
      expect(reducedMotion()).toBe(true);
      curtain.markLaunchPending();
      render(<Probe />);
      expect(last!.armed).toBe(false);
      expect(last!.slot(0)).toBeNull();
      expect(screen.getByTestId('wordmark').props.children).toBe('shown');
    } finally {
      act(() => { reduceListeners.forEach((fn) => fn(false)); });
    }
  });
});

// ── ReloadVeil ─────────────────────────────────────────────────────────────
describe('ReloadVeil', () => {
  it('renders nothing while it has never been active', () => {
    render(<View testID="host"><ReloadVeil active={false} /></View>);
    expect(screen.queryByTestId('root-nav-reload-overlay')).toBeNull();
  });

  it('blocks input from the first frame, shows after the grace, lets go and fades out', () => {
    const { rerender } = render(<ReloadVeil active />);
    const veil = () => screen.queryByTestId('root-nav-reload-overlay');
    expect(veil()).not.toBeNull();
    expect(veil()!.props.pointerEvents).toBe('auto');
    expect(screen.getByText('crane:MAGE ID')).toBeTruthy();
    advance(400); // past the grace + fade in
    rerender(<ReloadVeil active={false} />);
    expect(veil()).not.toBeNull();
    expect(veil()!.props.pointerEvents).toBe('none');
    advance(400);
    expect(veil()).toBeNull();
  });

  it('a reload shorter than the grace never shows and unmounts at once', () => {
    const { rerender } = render(<ReloadVeil active />);
    advance(100);
    rerender(<ReloadVeil active={false} />);
    expect(screen.queryByTestId('root-nav-reload-overlay')).toBeNull();
  });
});
