/**
 * Smoke — the level motion polish (lane MOTION). Assertions only, no snapshot.
 *
 *  - the new tokens are real: Motion.spring.sheet settles without a bounce,
 *    Motion.duration.tab is the 200 ms tab switch;
 *  - the phone tab switch is a FADE-THROUGH (tabFadeThrough): the leaving
 *    scene is gone before the arriving one shows, so two screens never
 *    ghost through each other; Reduce Motion drops the 8 pt rise;
 *  - <Sheet> on a phone travels a real sheet distance on open (not the old
 *    28 pt), and not at all under Reduce Motion;
 *  - ProjectHero draws its bracket with a native scaleX (no animated width) and
 *    starts nothing until the push transition's interactions have finished;
 *  - CashFlowChart stops every animation it started when it unmounts (the old
 *    pulse loops were never stopped and stacked up app-wide).
 */

import React from 'react';
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  InteractionManager,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Reduce Motion: motion.ts listens to the OS once, on its first read. Capture
// that listener so a test can flip the setting the way the OS would.
const reduceListeners: ((v: boolean) => void)[] = [];
jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((ev: string, fn: (v: boolean) => void) => {
  if (ev === 'reduceMotionChanged') reduceListeners.push(fn);
  return { remove() {} };
}) as never);

jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => ({
    screenSize: 'phone', isPhone: true, isTablet: false, isDesktop: false,
    width: 390, height: 844, contentMaxWidth: 390, sidebarWidth: 0, showSidebar: false, ganttRowHeight: 32,
  }),
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

// eslint-disable-next-line import/first
import { Motion } from '@/constants/designTokens';
// eslint-disable-next-line import/first
import { reducedMotion, tabFadeThrough, tabFadeThroughReduced } from '@/components/ui/motion';
// eslint-disable-next-line import/first
import { Sheet } from '@/components/ui/Sheet';
// eslint-disable-next-line import/first
import ProjectHero from '@/components/ProjectHero';
// eslint-disable-next-line import/first
import CashFlowChart from '@/components/CashFlowChart';
// eslint-disable-next-line import/first
import { INERT_PULSE, type ProjectPulse } from '@/utils/projectWorkspaceLayout';
// eslint-disable-next-line import/first
import type { Project } from '@/types';
// eslint-disable-next-line import/first
import type { CashFlowWeek } from '@/utils/cashFlowEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const Wrap = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
);
const flat = (s: unknown) => (StyleSheet.flatten(s as StyleProp<ViewStyle>) ?? {}) as Record<string, unknown>;
type Node = { type: unknown; props: Record<string, unknown> };
/** Every host node whose flattened style carries a transform. */
const transformed = (root: { findAll: (p: (n: Node) => boolean) => Node[] }) =>
  root.findAll((n) => typeof n.type === 'string' && Array.isArray(flat(n.props.style).transform));
/** An Animated node's current value; a host prop already holds the number. */
const valueOf = (v: unknown) => (typeof v === 'number' ? v : (v as { __getValue: () => number }).__getValue());

function setReduce(v: boolean) {
  reducedMotion(); // make sure motion.ts is listening
  act(() => { reduceListeners.forEach((fn) => fn(v)); });
}

beforeEach(() => {
  Dimensions.set({
    window: { width: 390, height: 844, scale: 3, fontScale: 1 },
    screen: { width: 390, height: 844, scale: 3, fontScale: 1 },
  });
});
afterEach(() => {
  setReduce(false);
  jest.restoreAllMocks();
});

describe('tokens', () => {
  it('Motion.spring.sheet settles without a bounce (ζ in [0.75, 1.05]); the tab switch is 200 ms', () => {
    const { damping, stiffness, mass } = Motion.spring.sheet;
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    expect(zeta).toBeGreaterThanOrEqual(0.75);
    expect(zeta).toBeLessThanOrEqual(1.05);
    expect(Motion.duration.tab).toBe(200);
    expect(Motion.stagger).toBe(35);
  });
});

describe('tabFadeThrough', () => {
  const at = (p: number, reduced = false) => {
    const f = reduced ? tabFadeThroughReduced : tabFadeThrough;
    return f({ current: { progress: new Animated.Value(p) } }).sceneStyle as {
      opacity: unknown;
      transform?: { translateY: unknown }[];
    };
  };
  it('the leaving scene is gone before the arriving one shows (no double exposure)', () => {
    for (const p of [-1, -0.45, 0.45, 1]) expect(valueOf(at(p).opacity)).toBe(0);
    const focused = at(0);
    expect(valueOf(focused.opacity)).toBe(1);
    expect(valueOf(focused.transform?.[0].translateY)).toBe(0);
    // Half way in, the arriving scene is still rising.
    expect(valueOf(at(1).transform?.[0].translateY)).toBe(8);
    expect(valueOf(at(-0.2).opacity)).toBeCloseTo(1 - 0.2 / 0.45, 5);
  });
  it('Reduce Motion: opacity only, no translateY key', () => {
    const s = at(0, true);
    expect(valueOf(s.opacity)).toBe(1);
    expect('transform' in s).toBe(false);
    expect(valueOf(at(0.45, true).opacity)).toBe(0);
  });
});

describe('<Sheet> on a phone', () => {
  function open() {
    const springs: { value: Animated.Value; to: number; config: Record<string, unknown> }[] = [];
    const real = Animated.spring;
    jest.spyOn(Animated, 'spring').mockImplementation(((value: Animated.Value, config: Record<string, unknown>) => {
      springs.push({ value, to: config.toValue as number, config });
      return real(value, config as never);
    }) as never);
    const r = render(<Wrap><Sheet visible={false} onClose={() => {}} title="Punch item"><Text>body</Text></Sheet></Wrap>);
    r.rerender(<Wrap><Sheet visible onClose={() => {}} title="Punch item"><Text>body</Text></Sheet></Wrap>);
    return { r, springs };
  }

  it('opening arms a rise that starts a real sheet distance low (> 28 pt) on Motion.spring.sheet', () => {
    const { r, springs } = open();
    const rise = springs.find((s) => s.to === 0);
    expect(rise).toBeTruthy();
    // 0.45 × 844 = 380 (capped at 420): the card comes up from below the screen.
    expect(valueOf(rise!.value)).toBe(380);
    expect(rise!.config).toMatchObject({ damping: 36, stiffness: 320, mass: 1 });
    const t = transformed(r.UNSAFE_root as never);
    expect(t.length).toBeGreaterThan(0);
    r.unmount();
  });

  it('Reduce Motion: no transform at all (fade only)', () => {
    setReduce(true);
    const { r, springs } = open();
    expect(springs.filter((s) => s.to === 0)).toHaveLength(0);
    expect(transformed(r.UNSAFE_root as never)).toHaveLength(0);
    r.unmount();
  });
});

describe('ProjectHero', () => {
  const pulse: ProjectPulse = {
    ...INERT_PULSE,
    hasProject: true,
    role: 'owner',
    canSeeMoney: true,
    costSourcesReady: true,
    living: { projected: { marginPct: 0.184 }, marginErosionPoints: 0, health: 'healthy' } as never,
    risk: { score: 30, hasBasis: true, band: 'low' } as never,
  };

  it('nothing starts before the push transition settles; the bracket is a native scaleX, never a width', () => {
    const pending: (() => void)[] = [];
    const cancel = jest.fn();
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation(((fn: () => void) => {
      pending.push(fn);
      return { cancel, then: () => undefined, done: () => undefined } as never;
    }) as never);
    const timing = jest.spyOn(Animated, 'timing');
    const spring = jest.spyOn(Animated, 'spring');

    const r = render(<ProjectHero project={{} as Project} pulse={pulse} />);
    expect(timing).not.toHaveBeenCalled();
    expect(spring).not.toHaveBeenCalled();
    expect(pending.length).toBeGreaterThanOrEqual(2);

    // The bracket bar: laid out at full width, drawn by a transform.
    const bars = transformed(r.UNSAFE_root as never).filter((n) => {
      const tf = flat(n.props.style).transform as Record<string, unknown>[];
      return tf.some((x) => 'scaleX' in x);
    });
    expect(bars).toHaveLength(1);
    const bar = flat(bars[0].props.style);
    expect(bar.width).toBe('100%');
    expect(bar.transformOrigin).toBe('left');
    expect(valueOf((bar.transform as { scaleX: unknown }[])[0].scaleX)).toBe(0);

    act(() => { pending.splice(0).forEach((fn) => fn()); });
    expect(timing).toHaveBeenCalled();
    // The bracket runs on the native driver now (it was a JS width animation).
    const bracketCall = timing.mock.calls.find((c) => (c[1] as { duration?: number }).duration === 900);
    expect(bracketCall && (bracketCall[1] as { useNativeDriver: boolean }).useNativeDriver).toBe(true);
    // No bubble: the hero's private margin-risk level is retired (one bubble,
    // one meaning — The Level lives in components/level/ProjectLevelCard).
    expect(spring).not.toHaveBeenCalled();

    r.unmount();
    expect(cancel).toHaveBeenCalled();
  });

  it('Reduce Motion: final values at once, nothing animates', () => {
    setReduce(true);
    const timing = jest.spyOn(Animated, 'timing');
    const spring = jest.spyOn(Animated, 'spring');
    const r = render(<ProjectHero project={{} as Project} pulse={pulse} />);
    expect(timing).not.toHaveBeenCalled();
    expect(spring).not.toHaveBeenCalled();
    expect(r.getByText('18.4')).toBeTruthy();
    r.unmount();
  });
});

describe('CashFlowChart', () => {
  const week = (net: number, bal: number, i: number): CashFlowWeek => ({
    weekStart: `2026-09-${String(1 + i * 7).padStart(2, '0')}`,
    weekEnd: `2026-09-${String(7 + i * 7).padStart(2, '0')}`,
    incomeItems: [],
    expenseItems: [],
    netCashFlow: net,
    runningBalance: bal,
  } as unknown as CashFlowWeek);

  it('unmount stops every animation it started (the pulse loop included)', () => {
    const stops: jest.Mock[] = [];
    const realLoop = Animated.loop;
    jest.spyOn(Animated, 'loop').mockImplementation(((a: Animated.CompositeAnimation, c?: object) => {
      const loop = realLoop(a, c as never);
      const stop = jest.fn(() => loop.stop());
      stops.push(stop);
      return { ...loop, start: (cb?: Animated.EndCallback) => loop.start(cb), stop };
    }) as never);
    const r = render(<CashFlowChart weeks={[week(5000, 5000, 0), week(-2000, 3000, 1), week(1000, 4000, 2)]} />);
    expect(stops.length).toBeGreaterThan(0);
    // Re-running the effect (a new horizon) stops the previous run too.
    r.rerender(<CashFlowChart weeks={[week(5000, 5000, 0), week(-2000, 3000, 1)]} />);
    expect(stops[0]).toHaveBeenCalled();
    r.unmount();
    for (const s of stops) expect(s).toHaveBeenCalled();
  });

  it('the bars grow by a native scaleY from the zero line (no animated height)', () => {
    const r = render(<CashFlowChart weeks={[week(5000, 5000, 0), week(-2000, 3000, 1)]} />);
    const bars = transformed(r.UNSAFE_root as never).filter((n) => {
      const tf = flat(n.props.style).transform as Record<string, unknown>[];
      return tf.some((x) => 'scaleY' in x);
    });
    expect(bars).toHaveLength(2);
    const [pos, neg] = bars.map((b) => flat(b.props.style));
    expect(typeof pos.height).toBe('number');
    expect(pos.transformOrigin).toBe('bottom');
    expect(neg.transformOrigin).toBe('top');
    r.unmount();
  });
});
