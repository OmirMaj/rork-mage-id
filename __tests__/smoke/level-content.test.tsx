/**
 * Smoke — the Level, lane CONTENT-A: skeletons, the busy Button, the Spinner.
 *
 * THE PROMISES THIS PROVES (plain assertions, no snapshot):
 *  - Skeleton: N skeletons share ONE loop (one start, one stop); unindexed
 *    blocks all sit at phase 0 (the same interpolation node); ListSkeleton's
 *    card 2 is shifted 0.2 of the cycle; Reduce Motion → a static 0.072 and no
 *    loop.
 *  - Button: an 80 ms save never shows the level (spinO stays 0) though busy
 *    and disabled were true at once; a 300 ms save shows it and holds it until
 *    120 + 400 = 520 ms before the morph back, with the press blocked through
 *    the hold; no per-press haptic; the done morph + a toast inside 400 ms buzz
 *    ONCE; an idle armed button holds no clock; a second press remounts the
 *    level visible from its first frame while spinO is still 0.
 *  - Spinner: role progressbar + its label.
 */

import React, { useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { act, cleanupAsync, fireEvent, render } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { ListSkeleton, Skeleton, skeletonClockStats } from '@/components/Skeleton';
import { Button, useCommitFeedback } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import LevelMark from '@/components/loaders/LevelMark';
import { levelClockStats } from '@/components/loaders/levelClock';
import { NailItToastHost, nailIt } from '@/components/animations/NailItToast';
import { __resetHapticsForTests } from '@/utils/haptics';
import { ACCELERATE, DECELERATE, linear, plateau, skeletonWave } from '@/utils/levelTimeline';

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
  return { ...actual, useReducedMotion: () => mockReduce, reducedMotion: () => mockReduce };
});

type AnimNode = { __getValue: () => number; _config?: { outputRange: number[] } };
const isNode = (x: unknown): x is AnimNode => !!x && typeof (x as AnimNode).__getValue === 'function';
type ReactTestInstance = ReturnType<typeof render>['UNSAFE_root'];
const flat = (s: unknown) => (StyleSheet.flatten(s as never) ?? {}) as Record<string, unknown>;

describe('The Level — content', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    __resetHapticsForTests();
  });
  afterEach(async () => {
    mockReduce = false;
    jest.useRealTimers();
    await cleanupAsync();
  });
  const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

  describe('Skeleton', () => {
    /** Every placeholder block's opacity, in render order (the composite Animated.Views carry the nodes). */
    const blockOpacities = (r: ReturnType<typeof render>) =>
      r.UNSAFE_getAllByType(Animated.View).map((n) => flat(n.props.style).opacity);

    it('three skeletons mount → ONE loop start; the last unmount stops it', () => {
      const before = skeletonClockStats();
      const r = render(<><Skeleton /><Skeleton /><Skeleton /></>);
      const during = skeletonClockStats();
      expect(during.count).toBe(3);
      expect(during.starts - before.starts).toBe(1);
      r.unmount();
      const after = skeletonClockStats();
      expect(after.count).toBe(0);
      expect(after.stops - before.stops).toBe(1);
    });

    it('unindexed blocks all share phase 0 (one interpolation node)', () => {
      const r = render(<><Skeleton /><Skeleton width={80} /><Skeleton col={3} /></>);
      const [a, b, c] = blockOpacities(r);
      expect(isNode(a)).toBe(true);
      expect(b).toBe(a);
      expect(c).toBe(a);
      expect((a as AnimNode)._config?.outputRange).toEqual(skeletonWave(0).outputRange);
      r.unmount();
    });

    it("ListSkeleton: card 2's first block is shifted 0.2 of the cycle", () => {
      const r = render(<ListSkeleton count={3} />);
      const ops = blockOpacities(r);
      expect(ops).toHaveLength(21); // 7 blocks per card
      const card0 = (ops[0] as AnimNode)._config!.outputRange;
      const card2 = (ops[14] as AnimNode)._config!.outputRange;
      expect(card0).toEqual(skeletonWave(0).outputRange);
      expect(card2).toEqual(skeletonWave(0.2).outputRange);
      // Where the dip sits: 0.2 of a cycle later on card 2 (samples are 1/32 apart).
      const dip = (xs: number[]) => xs.indexOf(Math.min(...xs)) / (xs.length - 1);
      expect(Math.abs(dip(card2) - dip(card0) - 0.2)).toBeLessThanOrEqual(1 / 32);
      r.unmount();
    });

    it('Reduce Motion: a static 0.072, no loop', () => {
      mockReduce = true;
      const before = skeletonClockStats();
      const r = render(<><Skeleton /><ListSkeleton count={1} /></>);
      const ops = blockOpacities(r);
      expect(ops.length).toBeGreaterThan(1);
      expect(ops.every((o) => o === 0.072)).toBe(true);
      expect(skeletonClockStats().count).toBe(0);
      expect(skeletonClockStats().starts).toBe(before.starts);
      r.unmount();
    });
  });

  describe('Button — the busy state', () => {
    // WHY CONFIGS, NOT VALUES: the busy timings run on the native driver, and
    // under this jest harness a native-driven Animated.timing never advances
    // its JS value (a control proved it: useNativeDriver:true stays at 0 after
    // 200 ms of fake time; false reaches 1). So the visual is proven from the
    // timing CONFIGS each value received (toValue, duration, the plateau
    // easing) and WHEN it received them; the bookkeeping (busy, disabled, the
    // hold, the clock) is read straight off the tree.
    type TimingCall = { value: Animated.Value; cfg: Animated.TimingAnimationConfig; at: number };
    let calls: TimingCall[] = [];
    let t0 = 0;
    let timingSpy: jest.SpyInstance | null = null;
    beforeEach(() => {
      calls = [];
      const orig = Animated.timing;
      timingSpy = jest.spyOn(Animated, 'timing').mockImplementation((value, cfg) => {
        calls.push({ value: value as Animated.Value, cfg, at: Date.now() - t0 });
        return orig(value, cfg);
      });
    });
    // Only this spy: restoreAllMocks would also strip the expo-haptics jest.fn mocks.
    afterEach(() => { timingSpy?.mockRestore(); timingSpy = null; });

    function Saver({ ms }: { ms: number }) {
      const [loading, setLoading] = useState(false);
      return (
        <Button
          testID="btn"
          label="Save"
          loading={loading}
          onPress={() => { setLoading(true); setTimeout(() => setLoading(false), ms); }}
        />
      );
    }
    // Time moves in 10 ms frames, each its own act(): one act() around a long
    // advance would batch every render (and so every layout effect, where the
    // hold timer is scheduled) until the advance is over — a harness artifact,
    // not app behaviour. 10 ms keeps the hold's edge (+520) exact.
    const step = (ms: number) => { for (let left = ms; left > 0; left -= 10) advance(Math.min(10, left)); };
    const pressable = (r: ReturnType<typeof render>) => r.getByTestId('btn');
    const press = (r: ReturnType<typeof render>) => { t0 = Date.now(); fireEvent.press(pressable(r)); };
    /** The three busy-entry timings of the latest press: labelO →0, labelY →−4, spinO →1. */
    const entry = () => {
      const labelO = [...calls].reverse().find((c) => c.cfg.toValue === 0 && c.cfg.duration === 240);
      const labelY = [...calls].reverse().find((c) => c.cfg.toValue === -4);
      const spin = [...calls].reverse().find((c) => c.cfg.toValue === 1 && c.cfg.duration === 340);
      if (!labelO || !labelY || !spin) throw new Error(`no busy entry in ${JSON.stringify(calls.map((c) => [c.cfg.toValue, c.cfg.duration]))}`);
      return { labelO, labelY, spin };
    };
    const SAMPLES = [0, 0.1, 0.25, 0.4, 0.5, 0.53, 0.6, 0.75, 0.9, 1];
    const sameCurve = (a: ((x: number) => number) | undefined, b: (x: number) => number) =>
      SAMPLES.every((x) => Math.abs((a ?? linear)(x) - b(x)) < 1e-9);
    /** Timings the spinO value received after the press settled (the fade-out). */
    const spinOut = (spin: Animated.Value) => calls.filter((c) => c.value === spin && c.cfg.toValue === 0);
    /** The level's own visibility (vis): the first animated opacity INSIDE the mark. */
    const levelVis = (r: ReturnType<typeof render>): AnimNode => {
      const mark = r.UNSAFE_getByType(LevelMark);
      const inner = mark.findAll((n: ReactTestInstance) => isNode(flat(n.props.style).opacity), { deep: true });
      if (!inner.length) throw new Error('no vis layer');
      return flat(inner[0].props.style).opacity as AnimNode;
    };

    it('the busy visual is baked into the easing: label 240 ms plateau 120/240 ACCELERATE, level 340 ms plateau 180/340 DECELERATE', () => {
      const r = render(<Saver ms={1000} />);
      try {
        press(r);
        const { labelO, labelY, spin } = entry();
        expect(labelO.at).toBe(0);
        expect(spin.at).toBe(0);
        expect(sameCurve(labelO.cfg.easing, plateau(120 / 240, ACCELERATE))).toBe(true);
        expect(labelY.cfg.duration).toBe(240);
        expect(sameCurve(labelY.cfg.easing, plateau(120 / 240, ACCELERATE))).toBe(true);
        expect(sameCurve(spin.cfg.easing, plateau(180 / 340, DECELERATE))).toBe(true);
        // Nothing moves inside the reveal: at +119 the label and the level are at their idle values.
        expect(labelO.cfg.easing!(119 / 240)).toBe(0);
        expect(spin.cfg.easing!(179 / 340)).toBe(0);
        expect(spin.cfg.easing!(1)).toBeCloseTo(1, 9);
      } finally { r.unmount(); }
    });

    it('an 80 ms save: busy + disabled at the press, the level never shows, no hold', () => {
      const r = render(<Saver ms={80} />);
      try {
        press(r);
        expect(pressable(r).props.accessibilityState).toEqual(expect.objectContaining({ busy: true, disabled: true }));
        const { labelO, spin } = entry();
        // At +80 both timings are still inside their plateaus: nothing was ever visible.
        expect(spin.cfg.easing!(80 / 340)).toBe(0);
        expect(labelO.cfg.easing!(80 / 240)).toBe(0);
        step(80);
        // Loading ended inside the reveal: snapped to idle at once, no hold, no fade tween.
        expect(pressable(r).props.accessibilityState).toEqual(expect.objectContaining({ busy: false, disabled: false }));
        expect((spin.value as unknown as AnimNode).__getValue()).toBe(0);
        expect((labelO.value as unknown as AnimNode).__getValue()).toBe(1);
        expect(spinOut(spin.value)).toHaveLength(0);
        expect(levelClockStats().count).toBe(0);
        step(600);
        expect(spinOut(spin.value)).toHaveLength(0);
        expect(Haptics.selectionAsync).not.toHaveBeenCalled();
      } finally { r.unmount(); }
    });

    it('a 300 ms save: the level holds until 120 + 400 = 520 ms, the press blocked through the hold, then fades', () => {
      const r = render(<Saver ms={300} />);
      try {
        press(r);
        const { spin } = entry();
        step(200);
        expect(levelClockStats().count).toBe(1); // the busy level holds the clock
        step(100); // +300: loading ends
        expect(pressable(r).props.accessibilityState).toEqual(expect.objectContaining({ busy: false, disabled: true }));
        step(210); // +510: still holding
        expect(spinOut(spin.value)).toHaveLength(0);
        expect(pressable(r).props.accessibilityState.disabled).toBe(true);
        step(20); // +530: the hold ended at +520 and the morph back began
        const out = spinOut(spin.value);
        expect(out).toHaveLength(1);
        expect(out[0].at).toBe(520);
        expect(out[0].cfg.duration).toBe(140);
        expect(pressable(r).props.accessibilityState.disabled).toBe(false);
        step(400);
        expect(levelClockStats().count).toBe(0); // the fade-out finished: no clock
        expect(Haptics.selectionAsync).not.toHaveBeenCalled();
      } finally { r.unmount(); }
    });

    it('an idle armed button holds no clock; a second press remounts the level, visible from frame 0 while spinO waits in its plateau', () => {
      const r = render(<Saver ms={300} />);
      try {
        press(r);
        step(200);
        expect(levelClockStats().count).toBe(1);
        const firstVis = levelVis(r);
        step(1200);
        expect(levelClockStats().count).toBe(0);
        // Idle: the armed level renders its static frame (no animated nodes, no clock).
        expect(r.UNSAFE_getByType(LevelMark).props.animate).toBe(false);
        press(r);
        const secondVis = levelVis(r);
        expect(secondVis).not.toBe(firstVis); // a new key: a fresh mount
        expect(secondVis.__getValue()).toBe(1); // revealDelayMs 0: spinO owns the reveal
        const { spin } = entry();
        expect(spin.at).toBe(0);
        expect(spin.cfg.easing!(0)).toBe(0); // spinO is at its idle 0 on this frame
        expect(levelClockStats().count).toBe(1);
        step(1200);
        expect(levelClockStats().count).toBe(0);
      } finally { r.unmount(); }
    });

    it('the done morph + a toast inside 400 ms buzz ONCE', async () => {
      function Committer() {
        const c = useCommitFeedback();
        return (
          <Button
            testID="btn"
            label="Send"
            loading={c.loading}
            done={c.done}
            onPress={() => { void c.run(() => new Promise((res) => setTimeout(res, 200))); }}
          />
        );
      }
      const r = render(<><Committer /><NailItToastHost /></>);
      try {
        press(r);
        // The work resolves at +200; its continuation (setPhase('done')) is a microtask.
        await act(async () => { jest.advanceTimersByTime(200); });
        await act(async () => { await Promise.resolve(); });
        expect(Haptics.notificationAsync).not.toHaveBeenCalled(); // still holding the busy visual
        step(340); // +540: past the 520 hold, the done morph has fired
        expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
        act(() => { nailIt('Sent'); });
        step(50);
        expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
        expect(Haptics.selectionAsync).not.toHaveBeenCalled();
        step(3000);
      } finally { r.unmount(); }
    });
  });

  describe('Spinner', () => {
    it('is a progressbar with its label', () => {
      const r = render(<Spinner label="Scoring bid" />);
      const el = r.getByTestId('spinner');
      expect(el.props.accessibilityRole).toBe('progressbar');
      expect(el.props.accessibilityLabel).toBe('Scoring bid');
      expect(el.props.accessible).toBe(true);
      expect(r.getByLabelText('Scoring bid')).toBeTruthy();
      r.unmount();
    });
  });
});
