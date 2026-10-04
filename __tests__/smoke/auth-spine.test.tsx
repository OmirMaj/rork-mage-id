/**
 * The auth spine ("Take D") — welcome / login / sign-up.
 *
 *   1. SpineHero at rest (jest never plays: the composed final state) carries
 *      five Sample tags, the building-department line, the Paid state, and is
 *      touch-through (pointerEvents="none").
 *   2. When it plays, the whole sequence is ONE timing on the native driver to
 *      the plan's total, plus the signature's own JS-driven timing delayed to
 *      the signature beat; unmount stops both.
 *   3. Reduce Motion (decidePlay): never plays; a mount that does not play
 *      shows the final state at once (Paid already lit).
 *   4. MiniSpine: five chips, Paid, one accessible summary naming the sample.
 *   5. /login and /signup mount with every auth testID of origin/main plus the
 *      mini spine (phone) or the full spine (desktop web).
 */
import React from 'react';
import { Animated, Dimensions, Platform, StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeSignedOut } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { planTotal, welcomePlan, miniPlan, SPINE_FINAL_CLOCK } from '@/utils/auth/spineSequence';
import { decidePlay } from '@/components/auth/spineClock';

jest.mock('@/components/BrandSplash', () => () => null);

let mockForceDesktopWeb = false;
jest.mock('@/components/ui/desktop', () => {
  const actual = jest.requireActual('@/components/ui/desktop');
  return { ...actual, useIsDesktopWeb: () => mockForceDesktopWeb || actual.useIsDesktopWeb() };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const SpineHero = require('@/components/auth/SpineHero').default as typeof import('@/components/auth/SpineHero').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MiniSpine = require('@/components/auth/MiniSpine').default as typeof import('@/components/auth/MiniSpine').default;

function allText(json: unknown): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n !== 'object') { out.push(String(n)); return; }
    walk((n as { children?: unknown }).children);
  };
  walk(json);
  return out.join(' ');
}

/** The Paid pill's own opacity: the nearest ancestor of the "Paid" text that sets one. */
function paidOpacity(): number | undefined {
  let node = screen.getByText('Paid').parent;
  for (let i = 0; node && i < 6; i++, node = node.parent) {
    const flat = StyleSheet.flatten(node.props.style) as { opacity?: number } | undefined;
    if (flat && typeof flat.opacity === 'number') return flat.opacity;
  }
  return undefined;
}

afterEach(() => {
  mockForceDesktopWeb = false;
  jest.restoreAllMocks();
});

describe('SpineHero', () => {
  it('at rest shows the composed final state: five Sample tags, the fine print, Paid; touch-through', () => {
    render(<SpineHero width={390} height={452} testID="spine" />);
    const text = allText(screen.toJSON());
    expect((text.match(/\bSample\b/g) ?? []).length).toBeGreaterThanOrEqual(6); // 5 tags + the fine print
    expect(text).toContain('Sample. Confirm requirements with your building department.');
    expect(text).toContain('$31,870');
    expect(text).toContain('$12,400.00');
    expect(text).toContain('Paid');
    expect(text).toContain('On track');
    const root = screen.getByTestId('spine');
    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.accessibilityLabel).toMatch(/^Sample project\./);
  });

  it('plays as one native-driven clock to the plan total, plus the JS-driven signature; unmount stops both', () => {
    const stops: jest.Mock[] = [];
    const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => {
      const stop = jest.fn();
      stops.push(stop);
      return { start: jest.fn(), stop, reset: jest.fn() } as unknown as Animated.CompositeAnimation;
    });
    const r = render(<SpineHero width={390} height={452} animate />);
    expect(timing).toHaveBeenCalledTimes(2);
    const [clockCfg, inkCfg] = timing.mock.calls.map((c) => c[1] as Animated.TimingAnimationConfig);
    const plan = welcomePlan();
    expect(clockCfg.toValue).toBe(planTotal(plan));
    expect(clockCfg.duration).toBe(planTotal(plan));
    expect(clockCfg.useNativeDriver).toBe(Platform.OS !== 'web');
    expect(inkCfg.useNativeDriver).toBe(false);
    expect(inkCfg.delay).toBe(plan.signature.at);
    r.unmount();
    expect(stops.every((s) => s.mock.calls.length === 1)).toBe(true);
  });

  it('Reduce Motion decides at mount: it never plays; jest never plays; only a test can force it', () => {
    expect(decidePlay(undefined, false, false)).toBe(true); // a device, motion on
    expect(decidePlay(undefined, false, true)).toBe(false); // a device, Reduce Motion
    expect(decidePlay(undefined, true, false)).toBe(false); // jest goldens
    expect(decidePlay(true, true, true)).toBe(true); // a test forcing the play
    expect(SPINE_FINAL_CLOCK).toBeGreaterThan(planTotal(welcomePlan()));
  });

  it('a mount that plays starts at the beginning (Paid not yet lit)', () => {
    jest.spyOn(Animated, 'timing').mockImplementation(() => (
      { start: jest.fn(), stop: jest.fn(), reset: jest.fn() } as unknown as Animated.CompositeAnimation
    ));
    render(<SpineHero width={390} height={452} animate />);
    expect(paidOpacity()).toBe(0);
  });

  it('a mount that does not play shows the final state at once, with nothing running', () => {
    const timing = jest.spyOn(Animated, 'timing');
    render(<SpineHero width={390} height={452} animate={false} />);
    expect(timing).not.toHaveBeenCalled();
    expect(paidOpacity()).toBe(1);
  });

  it('scales down to the room it is given, never up past maxScale', () => {
    render(<SpineHero width={195} height={900} testID="small" />);
    const small = screen.getByTestId('small');
    const flat = Array.isArray(small.props.style) ? Object.assign({}, ...small.props.style.filter(Boolean)) : small.props.style;
    expect(flat.width).toBeCloseTo(195);
  });
});

describe('MiniSpine', () => {
  it('five chips to Paid, one accessible summary naming the sample', () => {
    render(<MiniSpine width={390} testID="mini" />);
    const text = allText(screen.toJSON());
    for (const k of ['Ask', 'Estimate', 'Contract', 'Schedule', 'Invoice #12', 'Paid', '6 weeks', 'Sep 4']) expect(text).toContain(k);
    const root = screen.getByTestId('mini');
    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.accessibilityLabel).toMatch(/^Sample project:/);
  });

  it('plays its ~2 s reprise once: one clock on the native driver', () => {
    const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => (
      { start: jest.fn(), stop: jest.fn(), reset: jest.fn() } as unknown as Animated.CompositeAnimation
    ));
    render(<MiniSpine width={390} animate />);
    const clockCfg = timing.mock.calls[0][1] as Animated.TimingAnimationConfig;
    expect(clockCfg.toValue).toBe(planTotal(miniPlan()));
    expect(clockCfg.useNativeDriver).toBe(Platform.OS !== 'web');
  });
});

const LOGIN_IDS = ['login-apple', 'login-google', 'login-email', 'login-magic-link', 'login-show-password-mode', 'login-forgot', 'login-go-signup'];
const SIGNUP_IDS = ['signup-apple-top', 'signup-google-top', 'signup-name', 'signup-email', 'signup-password', 'signup-submit', 'signup-terms-link', 'signup-privacy-link', 'signup-go-login'];

/** Let the real app's providers settle (front-door's pump), so nothing is left running at teardown. */
async function settle(n = 6) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

function setWindow(width: number, height: number) {
  Dimensions.set({
    window: { width, height, scale: 2, fontScale: 1 },
    screen: { width, height, scale: 2, fontScale: 1 },
  });
}

describe('the auth routes wear the spine and keep every control', () => {
  beforeEach(() => { jest.useRealTimers(); allowConsoleErrors(); });

  it('/login on a phone: the mini spine, no hard hat, every auth control', async () => {
    setWindow(390, 844);
    await primeSignedOut();
    const tree = await mountRouteChecked('/login');
    await settle();
    expect(tree.getPathname()).toBe('/login');
    expect(screen.getByTestId('login-mini-spine')).toBeTruthy();
    expect(screen.queryByTestId('login-spine')).toBeNull();
    for (const id of LOGIN_IDS) expect(screen.getByTestId(id)).toBeTruthy();
    expect(screen.getByText('Welcome back')).toBeTruthy();
    expect(screen.getByText('Sign in')).toBeTruthy();
    await act(async () => { tree.unmount(); });
  });

  it('/login on desktop web: the full spine on the left, the form on the right', async () => {
    setWindow(1280, 800);
    mockForceDesktopWeb = true;
    await primeSignedOut();
    const tree = await mountRouteChecked('/login');
    await settle();
    expect(tree.getPathname()).toBe('/login');
    expect(screen.getByTestId('login-spine')).toBeTruthy();
    expect(screen.queryByTestId('login-mini-spine')).toBeNull();
    expect(screen.getByText('Sign in to MAGE ID')).toBeTruthy();
    for (const id of LOGIN_IDS) expect(screen.getByTestId(id)).toBeTruthy();
    await act(async () => { tree.unmount(); });
  });

  it('/signup on a phone: the same family, every sign-up control', async () => {
    setWindow(390, 844);
    await primeSignedOut();
    const tree = await mountRouteChecked('/signup');
    await settle();
    expect(tree.getPathname()).toBe('/signup');
    expect(screen.getByTestId('signup-mini-spine')).toBeTruthy();
    for (const id of SIGNUP_IDS) expect(screen.getByTestId(id)).toBeTruthy();
    expect(screen.getByText('Create your account')).toBeTruthy();
    await act(async () => { tree.unmount(); });
  });
});
