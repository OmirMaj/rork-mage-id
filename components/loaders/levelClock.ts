// levelClock.ts — the ONE shared level clock and the ONE Reduce-Motion clock.
//
// Every level on screen reads the same Animated.Value, so N marks move in step
// and the BrandSplash → BootShell hand-off keeps its phase. Each clock is one
// linear Animated.timing inside Animated.loop — the single-timing loop shape
// RN runs natively — so a pegged JS thread cannot drop a frame.
//
// Ref-counted exactly like components/Skeleton.tsx's shimmerCounter: the first
// subscriber resets the value to 0 and starts the loop (no mark is visible yet,
// so the reset is invisible); the last one stops it — the ONLY stop. Nothing
// ever calls stopAnimation / setValue on a clock while a subscriber exists:
// only a mark's own `amp` settles.
//
// Native only. On the web useLevelClock returns null and acquires nothing (web
// motion is CSS; a JS rAF loop would re-render every frame).

import { useEffect } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import { nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { LEVEL_PERIOD_MS, LEVEL_RM_PERIOD_MS } from '@/utils/levelTimeline';

/** Pure ref-count: first acquire starts, last release stops; extra releases are no-ops. */
export function clockCounter(start: () => void, stop: () => void) {
  let subscribers = 0;
  return {
    acquire(): void {
      subscribers += 1;
      if (subscribers === 1) start();
    },
    release(): void {
      if (subscribers === 0) return;
      subscribers -= 1;
      if (subscribers === 0) stop();
    },
    count: (): number => subscribers,
  };
}

interface LevelClock {
  value: Animated.Value;
  counter: ReturnType<typeof clockCounter>;
  starts: number;
  stops: number;
}

function makeClock(periodMs: number): LevelClock {
  const value = new Animated.Value(0);
  let loop: Animated.CompositeAnimation | null = null;
  const clock: LevelClock = {
    value,
    starts: 0,
    stops: 0,
    counter: clockCounter(
      () => {
        clock.starts += 1;
        value.setValue(0);
        loop = Animated.loop(Animated.timing(value, {
          toValue: 1,
          duration: periodMs,
          easing: Easing.linear,
          useNativeDriver: nativeDriver,
          isInteraction: false,
        }));
        loop.start();
      },
      () => {
        clock.stops += 1;
        loop?.stop();
        loop = null;
      },
    ),
  };
  return clock;
}

const main = makeClock(LEVEL_PERIOD_MS);
const rm = makeClock(LEVEL_RM_PERIOD_MS);

/**
 * The shared clock for a mark: the level clock normally, the Reduce-Motion
 * clock under Reduce Motion, null when inactive or on the web. Acquires and
 * releases in an effect keyed on (active, reduce), so a Reduce Motion flip
 * releases one clock and acquires the other.
 */
export function useLevelClock(active: boolean): Animated.Value | null {
  const reduce = useReducedMotion();
  const on = active && Platform.OS !== 'web';
  useEffect(() => {
    if (!on) return;
    const c = reduce ? rm : main;
    c.counter.acquire();
    return () => c.counter.release();
  }, [on, reduce]);
  if (!on) return null;
  return reduce ? rm.value : main.value;
}

/** Test / diagnostics: subscriber counts and start/stop tallies of both clocks. */
export function levelClockStats(): { count: number; starts: number; stops: number; rmCount: number; rmStarts: number; rmStops: number } {
  return {
    count: main.counter.count(), starts: main.starts, stops: main.stops,
    rmCount: rm.counter.count(), rmStarts: rm.starts, rmStops: rm.stops,
  };
}
