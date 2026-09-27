// BootShell — the first-boot loader that sits UNDER BrandSplash: the splash ink
// and the splash level at the native splash's exact rect (lane LAUNCH, on
// CORE's still-replica frame).
//
// BrandSplash is the ONLY owner of the launch timeline. BootShell mounts on the
// first _layout render, while the native splash is still up, and BrandSplash
// mounts later (or never: jest, a crash). If BootShell ran its own alive /
// wordmark clock from its own mount, the frames between the native splash
// leaving and BrandSplash's first paint (and the failsafe hand-back) would show
// a seeking bubble and a wordmark that BrandSplash then snaps back to centre —
// the restart the design forbids. So:
//
//   until BrandSplash FINISHES (components/launch/splashStage.ts `finished`):
//     a STILL replica — amp pinned 0, no wordmark, no hue layer, no timer.
//     That is also exactly the native splash picture.
//   on `finished` while the app is still NOT ready (the failsafe fired, or the
//   splash exited on a readiness that went stale): ADOPT the splash's stage in
//   one tick, before paint —
//     alive    → amp 1 at once (the splash was at amp 1 on the same shared
//                clock, so nothing jumps); else the 480 ms drift in;
//     wordmark → at rest at once; else it rises in at +500 ms (plateau-baked);
//     hue      → the hue layer at full at once.
//   on `finished` while the app IS ready: nothing (_layout replaces this on
//   the next render).
//
// The mark HOLDS the shared clock from mount (animate true, amp 0): when
// BrandSplash unmounts in the same commit, the clock's ref-count never touches
// 0, so it never stops or resets and the hand-back keeps phase. Under Reduce
// Motion it is a still frame (animate false, no clock) and an adopted wordmark
// fades without a rise. No theme at all (NATIVE_SPLASH_* + Type only), so it is
// safe outside every provider. Same splashRect, LevelMark tone/size/position,
// splashWordmarkBox and wordmark type as BrandSplash.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { Type } from '@/constants/typography';
import { deriveAccentPalette, getCustomPrimary } from '@/constants/colors';
import { getBootReady } from '@/components/launch/launchCurtain';
import { splashWordmarkBox, useSplashStage } from '@/components/launch/splashStage';
import {
  DECELERATE, LOADER, NATIVE_SPLASH_BG, NATIVE_SPLASH_FG, easeInOutSine, plateau, splashRect,
} from '@/utils/levelTimeline';
import LevelMark from './LevelMark';

const WORDMARK_RISE = 6;

type Adopted = { hue: boolean };

export default function BootShell({ testID = 'boot-shell' }: { testID?: string }) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const stage = useSplashStage();
  const ampRef = useRef(new Animated.Value(0));
  const hueMixRef = useRef(new Animated.Value(0));
  const wordmarkOpacityRef = useRef(new Animated.Value(0));
  const wordmarkYRef = useRef(new Animated.Value(WORDMARK_RISE));
  const [adopted, setAdopted] = useState<Adopted | null>(null);
  const runningRef = useRef<Animated.CompositeAnimation[]>([]);
  const rect = splashRect(width, height, Platform.OS);

  // THE ADOPTION — once, before paint, when BrandSplash has handed back and the
  // app is still loading.
  useLayoutEffect(() => {
    if (!stage.finished || adopted || getBootReady()) return;
    const run = (a: Animated.CompositeAnimation) => { runningRef.current.push(a); a.start(); };
    const amp = ampRef.current;
    if (stage.alive) amp.setValue(1);
    else if (!reduce) {
      run(Animated.timing(amp, {
        toValue: 1, duration: LOADER.splash.ampDriftMs, easing: easeInOutSine, useNativeDriver: nativeDriver, isInteraction: false,
      }));
    }
    const op = wordmarkOpacityRef.current;
    const y = wordmarkYRef.current;
    if (stage.wordmark) {
      op.setValue(1);
      y.setValue(0);
    } else {
      // The splash never showed it: it rises in at +500 ms from `finished`
      // (the delay is a plateau baked into the easing — no timer).
      const total = LOADER.splash.wordmarkAtMs + LOADER.splash.wordmarkMs;
      const easing = plateau(LOADER.splash.wordmarkAtMs / total, DECELERATE);
      run(Animated.timing(op, { toValue: 1, duration: total, easing, useNativeDriver: nativeDriver }));
      if (reduce) y.setValue(0);
      else run(Animated.timing(y, { toValue: 0, duration: total, easing, useNativeDriver: nativeDriver }));
    }
    hueMixRef.current.setValue(stage.hue ? 1 : 0);
    setAdopted({ hue: stage.hue });
  }, [stage, adopted, reduce]);

  useEffect(() => () => { runningRef.current.forEach((a) => a.stop()); }, []);

  const liveHue = deriveAccentPalette(getCustomPrimary(), 'dark').accent;
  const box = splashWordmarkBox(rect);

  return (
    <View
      testID={testID}
      style={styles.root}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading MAGE ID"
    >
      <View
        testID={`${testID}-mark`}
        style={{ position: 'absolute', left: rect.markLeft, top: rect.markTop, width: rect.markW, height: rect.markH }}
      >
        <LevelMark
          tone="splash"
          size={rect.markW}
          revealDelayMs={0}
          exit="none"
          amp={ampRef.current}
          animate={!reduce}
          hueColor={adopted?.hue ? liveHue : undefined}
          hueMix={adopted?.hue ? hueMixRef.current : undefined}
        />
      </View>
      {adopted && (
        <Animated.View
          testID={`${testID}-wordmark`}
          style={[styles.wordmarkBox, box, { opacity: wordmarkOpacityRef.current, transform: [{ translateY: wordmarkYRef.current }] }]}
        >
          <Animated.Text style={styles.wordmark} numberOfLines={1}>MAGE&nbsp;ID</Animated.Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NATIVE_SPLASH_BG },
  wordmarkBox: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  wordmark: {
    // Identical to BrandSplash's wordmark (Type.serifTitle's face, 28/32, 3.4 tracking).
    ...Type.serifTitle, // 28 / 32 in the display face
    letterSpacing: 3.4,
    color: NATIVE_SPLASH_FG,
    textAlign: 'center',
  },
});
