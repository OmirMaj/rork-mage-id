// BrandSplash — the in-app animated launch screen.
//
// The FIRST thing every user sees. The app's real brand motif: an ink field,
// the "MAGE ID" wordmark in the app's display face (Fraunces), and a thin amber
// spirit-level track whose bubble slides in off-centre and SETTLES DEAD CENTRE
// with a hair of overshoot — the move from components/PersonaSwitchOverlay.tsx
// and the marketing site. Construction for "everything is level, you're ready
// to build."
//
// Ink + amber only. No illustration, crest, gradient, glow, blur, or emoji.
// Colours/type come strictly from constants/colors + typography + tokens.
//
// How it's wired (see app/_layout.tsx):
//   - The NATIVE splash (app.json splash-icon.png, the flat level line) holds
//     the pre-JS moment. SplashScreen.preventAutoHideAsync() keeps it up.
//   - Once fonts load, _layout hides the native splash and mounts THIS
//     component as a full-screen overlay ABOVE the app. The app tree renders
//     and hydrates underneath.
//   - Plays once per cold start. onDone() unmounts it.
//
// THE HAND-OFF (slick round 3). The splash no longer fades at a fixed time.
// It HOLDS until the app underneath is ready (RootLayoutNav's setBootReady)
// and the first screen has reported where its own "MAGE ID" sits
// (components/launch/launchCurtain.ts), then hands off instead of cutting:
//   - the wordmark flies (translate + uniform scale) onto the screen's own
//     wordmark and cross-fades into it;
//   - the eyebrow and the spirit level fold away (the track retracts to its
//     centre notch);
//   - the ink dissolves while the screen's blocks rise in on a stagger
//     (components/auth/authMotion.tsx useLaunchEntrance).
// With no target (a signed-in user landing on Home) the centre group rises
// 10 pt and fades while the ink dissolves. The exit starts unconditionally at
// EXIT_BY_MS, and SPLASH_FAILSAFE still bounds the whole lifetime.
//
// Timeline (entry, as before):
//   0ms        — ink field + wordmark/eyebrow already painted (no flash)
//   40–340ms   — eyebrow + wordmark settle up
//   180ms      — level track draws in
//   300ms      — bubble springs from off-centre → dead centre (ζ≈0.81)
//   then       — hold until ready, then the ~0.5 s hand-off above
//
// Reduced motion (AccessibilityInfo, latched) → paint the settled state, hold
// until the same ready rule (min 500 ms), fade the overlay, done. No fly, no
// 'lifting', so no screen entrance arms. Web-safe: haptics guarded, and every
// Animated call uses the native driver only where it exists.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Type } from '@/constants/typography';
import { Motion, Tokens } from '@/constants/designTokens';
import { nativeDriver } from '@/components/ui/motion';
import {
  getBootReady,
  getLaunchTarget,
  markLaunchPending,
  setLaunchPhase,
  subscribeLaunch,
  type LaunchRect,
} from '@/components/launch/launchCurtain';

// The app tree mounts under the NATIVE splash before this component can; mark the curtain now so a
// fast /login's first render already sees 'covered'. Never under jest: _layout imports this module in
// every smoke test that mounts the real layout (mountRoute → renderRouter('app')), and a mark there would
// arm the login/signup entrance in existing goldens (desktop-page-frame '/signup') depending on test timing.
const UNDER_JEST = typeof process !== 'undefined' && process.env?.JEST_WORKER_ID != null;
if (!UNDER_JEST) markLaunchPending();

// ── Brand tokens ────────────────────────────────────────────────────────────
// The splash is a fixed BRAND moment — always the ink field regardless of the
// user's light/dark preference. A splash that flashed cream-white in light
// mode would be jarring and wouldn't match the ink native layer it hands off
// from. These match constants/colors.ts Theme.dark + the marketing --ink.
const INK = '#0B0D10';
const CREAM = '#F4EFE6';
const FOG = 'rgba(244,239,230,0.62)';
const AMBER = '#FF6A1A';
const AMBER_SOFT = 'rgba(255,106,26,0.16)';
const LINE = 'rgba(255,255,255,0.10)';
const NOTCH = 'rgba(244,239,230,0.32)';

// ── Level geometry (from PersonaSwitchOverlay) ───────────────────────────────
const LEVEL_TRACK_W = 200;
const BUBBLE_W = 34;
const BUBBLE_START_X = -62; // off-centre; settles at 0

// ── Timings (ms) — the entry mirrors PersonaSwitchOverlay ────────────────────
const T_LABEL = 40;
const T_TRACK = 180;
const T_BUBBLE = 300;

// The bubble's settle: a hair of overshoot, no wobble (was 12/150/0.9, ζ≈0.52).
// ζ = 20 / (2·√(170·0.9)) ≈ 0.81 — hoist into Motion.spring after round 3
const BUBBLE_SPRING = { damping: 20, stiffness: 170, mass: 0.9 };

// ── The hand-off ─────────────────────────────────────────────────────────────
// Wait this long after the app is ready for the first screen to report its
// wordmark; past it, the no-target exit runs. hoist into Motion.duration after round 3
const TARGET_GRACE_MS = 150;
// The exit starts unconditionally this long after mount. hoist into Motion.duration after round 3
const EXIT_BY_MS = 2300;
// The longest exit leg: the fly's cap (FLY_CAP_MS) + the cross-fade (FLY_FADE_MS).
// EXIT_BY_MS + EXIT_MS stays under SPLASH_MAX_LIFETIME_MS. hoist into Motion.duration after round 3
const EXIT_MS = 520;
// hoist into Motion.duration after round 3
const FLY_CAP_MS = 420;
// hoist into Motion.duration after round 3
const FLY_FADE_MS = 100;
// hoist into Motion.duration after round 3
const FOLD_MS = 140;
// hoist into Motion.duration after round 3
const TRACK_RETRACT_MS = 160;
// hoist into Motion.duration after round 3
const INK_DELAY_MS = 60;
// hoist into Motion.duration after round 3
const INK_FADE_MS = 280;
// No target: the centre group rises and fades. hoist into Motion.duration after round 3
const RISE_OUT_MS = 160;
// Reduced motion: the minimum settled hold, then the overlay fade. hoist into Motion.duration after round 3
const REDUCED_HOLD_MS = 500;
// hoist into Motion.duration after round 3
const REDUCED_FADE_MS = 200;

// Hard ceiling on the overlay's total lifetime, measured from mount.
// The splash now holds for the app (EXIT_BY_MS at the latest) and its exit is
// bounded by EXIT_MS; on a congested cold start the Animated callbacks are
// JS-driven and can land late because the JS thread is saturated by route
// resolution + provider hydration. Nothing can push the splash past this.
// See SPLASH_FAILSAFE below for why this must not depend on Animated.
export const SPLASH_MAX_LIFETIME_MS = 3000;

// How long we'll wait for the native reduced-motion query before assuming
// "no". Until it answers we paint a bare ink field with no wordmark, and
// AccessibilityInfo.isReduceMotionEnabled() is an unbounded native promise.
const REDUCE_MOTION_QUERY_TIMEOUT_MS = 250;

export interface BrandSplashProps {
  /** Called when the splash finishes and the app should be revealed. */
  onDone: () => void;
}

type Measurable = { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void };

export default function BrandSplash({ onDone }: BrandSplashProps) {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const doneRef = useRef(false);
  const mountedAtRef = useRef(Date.now());
  const wordmarkRef = useRef<Text | null>(null);
  const srcRectRef = useRef<LaunchRect | null>(null);

  // Animated values
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const inkOpacity = useRef(new Animated.Value(1)).current;
  const labelOpacity = useRef(new Animated.Value(0)).current;
  const labelTranslate = useRef(new Animated.Value(10)).current;
  const trackScaleX = useRef(new Animated.Value(0)).current;
  const bubbleX = useRef(new Animated.Value(BUBBLE_START_X)).current;
  const eyebrowOut = useRef(new Animated.Value(1)).current;
  const levelOut = useRef(new Animated.Value(1)).current;
  const flyOpacity = useRef(new Animated.Value(1)).current;
  // One value drives the whole fly: translate = fly·(dx, dy), scale = 1 + fly·(k − 1).
  const fly = useRef(new Animated.Value(0)).current;
  const flyDx = useRef(new Animated.Value(0)).current;
  const flyDy = useRef(new Animated.Value(0)).current;
  const flyDk = useRef(new Animated.Value(0)).current;
  const flyTransform = useRef([
    { translateX: Animated.multiply(fly, flyDx) },
    { translateY: Animated.multiply(fly, flyDy) },
    { scale: Animated.add(1, Animated.multiply(fly, flyDk)) },
  ]).current;

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    // Snap transparent before handing back. If we got here from an interrupted
    // animation or the failsafe, overlayOpacity is stranded part-way and the
    // parent's unmount is a commit away — without this the wordmark would be
    // painted over the app for that frame.
    overlayOpacity.setValue(0);
    // The curtain is up: every waiting screen snaps to rest.
    setLaunchPhase('open');
    onDone();
  }, [onDone, overlayOpacity]);

  // The curtain is down while this is mounted. Refreshes the pending mark's
  // clock; an unmount without finish() lifts it.
  useLayoutEffect(() => {
    setLaunchPhase('covered');
    return () => {
      if (!doneRef.current) setLaunchPhase('open');
    };
  }, []);

  // SPLASH_FAILSAFE — the overlay's lifetime is bounded by wall clock and by
  // nothing else.
  //
  // Every other dismiss path funnels through an Animated completion callback,
  // and that callback is not a guarantee: Animated.parallel defaults to
  // stopTogether, so ANY interrupted leg reports finished:false for the whole
  // group; the Animated.delay legs are JS-driven, so a saturated JS thread can
  // starve them; and a native-driver callback that never makes it back over
  // the bridge simply never arrives. Because this component renders a
  // full-screen overlay ABOVE a live, hydrating app rather than gating it, any
  // of those left the "MAGE ID" wordmark painted translucently over the home
  // feed permanently — the deep-link cold-start bug. A launch screen that
  // outlives its animation is a bug, so time it out unconditionally.
  useEffect(() => {
    const failsafe = setTimeout(finish, SPLASH_MAX_LIFETIME_MS);
    return () => clearTimeout(failsafe);
  }, [finish]);

  // Resolve reduced-motion once. We deliberately latch the FIRST answer and do
  // not subscribe to later 'reduceMotionChanged' events: the splash lives for
  // a couple of seconds at most, so re-deciding the path mid-play can only
  // interrupt the running animation — it can't improve anything.
  useEffect(() => {
    let active = true;
    const settle = (v: boolean) => {
      if (!active) return;
      active = false;
      setReduceMotion(v);
    };
    AccessibilityInfo.isReduceMotionEnabled()
      .then(settle)
      .catch(() => settle(false));
    // The native query is an unbounded promise; don't sit on a bare ink field
    // waiting for it on a congested cold start.
    const t = setTimeout(() => settle(false), REDUCE_MOTION_QUERY_TIMEOUT_MS);
    return () => { active = false; clearTimeout(t); };
  }, []);

  useEffect(() => {
    // Wait until we know the reduced-motion preference before choosing a path.
    if (reduceMotion === null) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const running: Animated.CompositeAnimation[] = [];
    let entryDone = false;
    let exitStarted = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let graceOver = false;
    let entry: Animated.CompositeAnimation | null = null;

    // `anim` IS the exit's last leg. Its end callback dismisses on EVERY end,
    // interrupted or not. Gating this on `finished` was the deep-link
    // cold-start bug: a stopped animation reported finished:false, the early
    // return skipped onDone(), and the overlay stayed painted over the app
    // forever at whatever opacity it had reached. The splash is never
    // load-bearing — revealing the app early is always correct, leaving it
    // covered never is.
    const endWith = (anim: Animated.CompositeAnimation, haptic: boolean) => {
      running.push(anim);
      anim.start(({ finished }) => {
        if (haptic && finished && Platform.OS !== 'web') {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        finish();
      });
    };

    const fadeInk = () => Animated.sequence([
      Animated.delay(INK_DELAY_MS),
      Animated.timing(inkOpacity, {
        toValue: 0, duration: INK_FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
      }),
    ]);

    // The hand-off, once the source wordmark is measured (or not).
    const runExit = (src: LaunchRect | null) => {
      if (doneRef.current) return;
      setLaunchPhase('lifting');
      // The exit is bounded too: whatever its legs report, it ends by EXIT_MS.
      timers.push(setTimeout(finish, EXIT_MS + 50));
      const target = getLaunchTarget();

      if (target && src && src.width > 0 && src.height > 0) {
        const k = Math.min(1, Math.max(0.15, target.width / src.width));
        flyDx.setValue((target.x + target.width / 2) - (src.x + src.width / 2));
        flyDy.setValue((target.y + target.height / 2) - (src.y + src.height / 2));
        flyDk.setValue(k - 1);

        const lift = Animated.parallel([
          Animated.timing(eyebrowOut, {
            toValue: 0, duration: FOLD_MS, easing: Easing.in(Easing.cubic), useNativeDriver: nativeDriver,
          }),
          Animated.timing(levelOut, {
            toValue: 0, duration: FOLD_MS, easing: Easing.in(Easing.cubic), useNativeDriver: nativeDriver,
          }),
          // The track folds to its centre notch.
          Animated.timing(trackScaleX, {
            toValue: 0, duration: TRACK_RETRACT_MS, easing: Easing.in(Easing.cubic), useNativeDriver: nativeDriver,
          }),
          fadeInk(),
        ]);
        running.push(lift);
        lift.start();

        let landed = false;
        const land = () => {
          if (landed || doneRef.current) return;
          landed = true;
          // The screen's own wordmark shows beneath; this one cross-fades out.
          setLaunchPhase('landed');
          const anim = Animated.timing(flyOpacity, {
            toValue: 0, duration: FLY_FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
          });
          endWith(anim, true);
        };
        const flight = Animated.spring(fly, { toValue: 1, ...Motion.spring.rise, useNativeDriver: nativeDriver });
        running.push(flight);
        flight.start(() => land());
        timers.push(setTimeout(land, FLY_CAP_MS));
        return;
      }

      // No target (Home, persona-select, onboarding, …): rise and fade.
      setLaunchPhase('landed');
      const anim = Animated.parallel([
        Animated.timing(labelTranslate, {
          toValue: -10, duration: RISE_OUT_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
        }),
        Animated.timing(labelOpacity, {
          toValue: 0, duration: RISE_OUT_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
        }),
        fadeInk(),
      ]);
      endWith(anim, true);
    };

    const startExit = () => {
      if (exitStarted || doneRef.current) return;
      exitStarted = true;
      entry?.stop();

      if (reduceMotion) {
        // Reduced: never 'lifting', so no screen entrance arms.
        const anim = Animated.timing(overlayOpacity, {
          toValue: 0, duration: REDUCED_FADE_MS, easing: Easing.out(Easing.ease), useNativeDriver: nativeDriver,
        });
        endWith(anim, false);
        return;
      }

      // Measure the wordmark where it sits NOW (after the entry's rise).
      let proceeded = false;
      const go = (src: LaunchRect | null) => {
        if (proceeded) return;
        proceeded = true;
        runExit(src);
      };
      const node = wordmarkRef.current as unknown as Measurable | null;
      if (node?.measureInWindow) {
        node.measureInWindow((x, y, width, height) => {
          go(width > 0 && height > 0 ? { x, y, width, height } : srcRectRef.current);
        });
        timers.push(setTimeout(() => go(srcRectRef.current), 60));
      } else {
        go(srcRectRef.current);
      }
    };

    const tryExit = () => {
      if (exitStarted || doneRef.current || !entryDone || !getBootReady()) return;
      if (!getLaunchTarget() && !graceOver) return;
      startExit();
    };

    const onLaunchChange = () => {
      if (getBootReady() && graceTimer == null && !graceOver) {
        graceTimer = setTimeout(() => { graceOver = true; tryExit(); }, TARGET_GRACE_MS);
        timers.push(graceTimer);
      }
      tryExit();
    };
    const unsubscribe = subscribeLaunch(onLaunchChange);

    // The exit starts by EXIT_BY_MS after mount, whatever is still loading.
    timers.push(setTimeout(() => {
      entryDone = true;
      graceOver = true;
      startExit();
    }, Math.max(0, EXIT_BY_MS - (Date.now() - mountedAtRef.current))));

    if (reduceMotion) {
      // Reduced motion: paint the settled state, hold, then the same ready rule.
      labelOpacity.setValue(1);
      labelTranslate.setValue(0);
      trackScaleX.setValue(1);
      bubbleX.setValue(0);
      timers.push(setTimeout(() => { entryDone = true; tryExit(); }, REDUCED_HOLD_MS));
      onLaunchChange();
      return () => {
        unsubscribe();
        timers.forEach(clearTimeout);
        running.forEach((a) => a.stop());
      };
    }

    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    // Spring physics only on native; web keeps its timing for the bubble.
    const springy = Platform.OS !== 'web';

    entry = Animated.parallel([
      // Eyebrow + wordmark settle up.
      Animated.sequence([
        Animated.delay(T_LABEL),
        Animated.parallel([
          Animated.timing(labelOpacity, {
            toValue: 1, duration: 260, easing: Easing.out(Easing.ease), useNativeDriver: nativeDriver,
          }),
          Animated.timing(labelTranslate, {
            toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
          }),
        ]),
      ]),

      // The level track draws in.
      Animated.sequence([
        Animated.delay(T_TRACK),
        Animated.timing(trackScaleX, {
          toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
        }),
      ]),

      // The bubble slides from off-centre and settles DEAD CENTRE.
      Animated.sequence([
        Animated.delay(T_BUBBLE),
        springy
          ? Animated.spring(bubbleX, { toValue: 0, ...BUBBLE_SPRING, useNativeDriver: nativeDriver })
          : Animated.timing(bubbleX, {
              toValue: 0, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
            }),
      ]),
    ]);
    // The entry ending (finished or not) never dismisses: it only lets the
    // exit start once the app is ready.
    entry.start(() => { entryDone = true; tryExit(); });
    onLaunchChange();

    return () => {
      unsubscribe();
      timers.forEach(clearTimeout);
      entry?.stop();
      running.forEach((a) => a.stop());
    };
  }, [
    reduceMotion, overlayOpacity, inkOpacity, labelOpacity, labelTranslate, trackScaleX, bubbleX,
    eyebrowOut, levelOut, flyOpacity, fly, flyDx, flyDy, flyDk, finish,
  ]);

  const onWordmarkLayout = useCallback(() => {
    const node = wordmarkRef.current as unknown as Measurable | null;
    node?.measureInWindow?.((x, y, width, height) => {
      if (width > 0 && height > 0) srcRectRef.current = { x, y, width, height };
    });
  }, []);

  // Don't paint until we know the motion preference (one frame) so we never
  // start the motion path and then swap to the reduced path mid-animation.
  if (reduceMotion === null) {
    return <View style={[styles.overlay, styles.ink]} pointerEvents="none" />;
  }

  return (
    <Animated.View
      style={[styles.overlay, { opacity: overlayOpacity }]}
      pointerEvents="none"
      testID="brand-splash"
    >
      {/* The ink field, on its own layer so it can dissolve under the fly. */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.ink, { opacity: inkOpacity }]} />
      <Animated.View
        style={[styles.center, { opacity: labelOpacity, transform: [{ translateY: labelTranslate }] }]}
      >
        <Animated.View style={{ opacity: eyebrowOut }}>
          <Text style={styles.eyebrow}>
            <Text style={styles.eyebrowDot}>●</Text>  THE OPERATING SYSTEM FOR BUILDERS
          </Text>
        </Animated.View>
        <Animated.View style={[styles.wordmarkWrap, { opacity: flyOpacity, transform: flyTransform }]}>
          <Text ref={wordmarkRef} onLayout={onWordmarkLayout} style={styles.wordmark} numberOfLines={1}>MAGE&nbsp;ID</Text>
        </Animated.View>

        {/* The spirit level — bubble settles dead centre. */}
        <Animated.View style={{ opacity: levelOut }}>
          <View style={styles.levelWrap}>
            <Animated.View style={[styles.levelTrack, { transform: [{ scaleX: trackScaleX }] }]} />
            <View style={[styles.levelNotch, styles.notchLeft]} />
            <View style={[styles.levelNotch, styles.notchRight]} />
            <View style={styles.levelNotchCenter} />
            <Animated.View style={[styles.bubble, { transform: [{ translateX: bubbleX }] }]} />
          </View>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  ink: {
    backgroundColor: INK,
  },
  center: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  eyebrow: {
    ...Type.monoEyebrow,
    color: FOG,
    textAlign: 'center',
    marginBottom: 18,
  },
  eyebrowDot: {
    color: AMBER,
  },
  // The wordmark's spacing lives on its fly wrapper, so the wrapper's box IS
  // the Text's box and the fly's scale pivots on the wordmark's own centre.
  wordmarkWrap: {
    marginBottom: 28,
  },
  wordmark: {
    // Fraunces 700 Bold — the app's display face (loaded in _layout.tsx).
    // Falls back to the platform serif if the font network-blips on first
    // launch; the wordmark still reads.
    fontFamily: 'Fraunces_700Bold',
    fontSize: 44,
    lineHeight: 50,
    letterSpacing: 2,
    color: CREAM,
    textAlign: 'center',
  },
  levelWrap: {
    width: LEVEL_TRACK_W,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    borderRadius: Tokens.radius.full,
    backgroundColor: AMBER_SOFT,
  },
  levelNotch: {
    position: 'absolute',
    width: 3,
    height: 12,
    borderRadius: Tokens.radius.full,
    backgroundColor: NOTCH,
  },
  notchLeft: { left: 0 },
  notchRight: { right: 0 },
  levelNotchCenter: {
    position: 'absolute',
    width: 2,
    height: 8,
    borderRadius: Tokens.radius.full,
    backgroundColor: LINE,
  },
  bubble: {
    position: 'absolute',
    width: BUBBLE_W,
    height: 11,
    borderRadius: Tokens.radius.full,
    backgroundColor: AMBER,
  },
});
