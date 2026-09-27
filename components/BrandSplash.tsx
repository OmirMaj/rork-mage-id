// BrandSplash — the cold start CONTINUES the native splash (lane LAUNCH).
//
// The native splash (assets/images/splash-icon.png) is one orange spirit level
// on ink. This component is that SAME level, in the same pixels at the same
// place (utils/levelTimeline.ts splashRect + CORE's LevelMark tone="splash"),
// painted on the very first commit as plain Views — never an <Image> of the PNG,
// which decodes async on iOS and can blink bare ink. From there it is ONE object:
//
//   frame 0      the native picture, still. No eyebrow, no big wordmark, no
//                bubble springing in from off-centre.
//   +400 ms      only if the app is NOT ready yet: the bubble starts to seek
//                (host amp 0→1, plateau-baked into one timing on the shared
//                clock), and the hue shifts to the user's accent WHILE it moves.
//   +500 ms      only if still not ready (signed in): a small "MAGE ID" rises in
//                above the level — the level never moves off centre for it.
//                Signed out: the wordmark shows at max(160 ms, the moment the
//                login registered its own wordmark) so it can fly onto it.
//   ready        (launchCurtain's getBootReady + TARGET_GRACE_MS): the bubble
//                settles dead centre, the level folds (CORE's retract ranges),
//                the ink dissolves onto the app. Ready before +400 ms → the
//                bubble never moved: one still image, a 280 ms dissolve, done.
//
// No haptic: a launch is not a success event.
//
// NO THEME. This mounts OUTSIDE ThemeProvider in app/_layout.tsx, where
// useTheme() returns undefined. It never reads a theme: colours are the
// NATIVE_SPLASH_* constants (equal to the baked PNG) and the user's hue from
// deriveAccentPalette(getCustomPrimary(), 'dark').
//
// It is the ONLY owner of the launch timeline. It publishes what it has shown
// (components/launch/splashStage.ts); BootShell, the still replica underneath,
// adopts that state when this finishes while the app is still loading.
//
// Reduce Motion (AccessibilityInfo, latched, 250 ms timeout): the level is a
// still frame (animate={false}: no clock, no breath), the wordmark fades in
// without a rise if its rule fires, and on ready the overlay fades in 200 ms.
// Never 'lifting', so no screen entrance arms. No minimum hold.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Type } from '@/constants/typography';
import { Motion } from '@/constants/designTokens';
import { deriveAccentPalette, getCustomPrimary } from '@/constants/colors';
import { nativeDriver } from '@/components/ui/motion';
import LevelMark from '@/components/loaders/LevelMark';
import {
  getBootReady,
  getLaunchTarget,
  markLaunchPending,
  setLaunchPhase,
  subscribeLaunch,
  type LaunchRect,
} from '@/components/launch/launchCurtain';
import { setSplashStage, splashWordmarkBox } from '@/components/launch/splashStage';
import {
  DECELERATE,
  LOADER,
  NATIVE_SPLASH_ACCENT,
  NATIVE_SPLASH_BG,
  NATIVE_SPLASH_FG,
  STANDARD,
  easeInOutSine,
  easeOutCubic,
  linear,
  plateau,
  splashRect,
} from '@/utils/levelTimeline';

// The app tree mounts under the NATIVE splash before this component can; mark the curtain now so a
// fast /login's first render already sees 'covered'. Never under jest: _layout imports this module in
// every smoke test that mounts the real layout (mountRoute → renderRouter('app')), and a mark there would
// arm the login/signup entrance in existing goldens (desktop-page-frame '/signup') depending on test timing.
const UNDER_JEST = typeof process !== 'undefined' && process.env?.JEST_WORKER_ID != null;
if (!UNDER_JEST) markLaunchPending();

// ── The timeline (CORE's numbers, never re-declared) ─────────────────────────
const SPLASH = LOADER.splash;
const EXIT = LOADER.splash.exit;
/** The fast-boot line: ready before this and the bubble never moves. */
const ALIVE_MS = SPLASH.aliveAtMs;
/** Signed out: the earliest the wordmark shows (so the fly has a source). */
const SIGNED_OUT_WORDMARK_MS = 160;
/** The wordmark's rise, pt. */
const WORDMARK_RISE = 6;

// ── The hand-off ─────────────────────────────────────────────────────────────
// Wait this long after the app is ready for the first screen to report its
// wordmark; past it, the no-target exit runs.
const TARGET_GRACE_MS = 150;
// The longest exit leg: ≥ the signed-in exit (EXIT.retractAtMs + EXIT.retractSpanMs
// = 480) and ≥ the fly's cap + its cross-fade (FLY_CAP_MS + FLY_FADE_MS = 520).
const EXIT_MS = 520;
const FLY_CAP_MS = 420;
const FLY_FADE_MS = 100;
// The fly's ink: a 60 ms plateau, then 280 ms (baked into one timing, no delay leg).
const FLY_INK_AT_MS = 60;
const FLY_INK_MS = 280;
// A missed notify must never strand the ink over a ready app.
const READY_BACKSTOP_MS = 500;

// Hard ceiling on the overlay's total lifetime, measured from mount
// (= LOADER.splash.failsafeMs). Why 8 s is safe:
//   - if boot IS ready, the exit started long before (the 500 ms readiness
//     backstop re-checks even when a notify was missed);
//   - if boot is still NOT ready, the screen UNDER the splash is BootShell,
//     which on `finished` ADOPTS this splash's stage — the same ink, the same
//     level on the SAME shared clock phase, amp 1 at once if this was alive,
//     the wordmark at rest if this showed it — so the failsafe's dissolve is
//     invisible. It used to be 3 s and uncovered a second, different loader.
// See SPLASH_FAILSAFE below for why this must not depend on Animated.
export const SPLASH_MAX_LIFETIME_MS = 8000;

// How long we'll wait for the native reduced-motion query before assuming
// "no". It only decides whether the bubble will ever move: frame 0 is static,
// so it never waits for this.
const REDUCE_MOTION_QUERY_TIMEOUT_MS = 250;

export interface BrandSplashProps {
  /** Called when the splash finishes and the app should be revealed. */
  onDone: () => void;
  /**
   * The timeline's t = 0 is the moment this is first true (default: mount).
   * Before it, the splash is frame 0 only (the native splash is still over it).
   */
  live?: boolean;
  /**
   * Called ONCE after the first layout + one animation frame: the JS replica is
   * painted, so the native splash may leave without a blink.
   */
  onFirstFrame?: () => void;
}

type Measurable = { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void };

interface Controller {
  startAmp: () => void;
}

export default function BrandSplash({ onDone, live = true, onFirstFrame }: BrandSplashProps) {
  const { width, height } = useWindowDimensions();
  const rect = splashRect(width, height, Platform.OS);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [isLive, setIsLive] = useState(live);
  if (live && !isLive) setIsLive(true);
  const [wordmarkOn, setWordmarkOn] = useState(false);

  const doneRef = useRef(false);
  const reduceRef = useRef<boolean | null>(null);
  reduceRef.current = reduceMotion;
  const controllerRef = useRef<Controller | null>(null);
  const wordmarkRef = useRef<Text | null>(null);
  const srcRectRef = useRef<LaunchRect | null>(null);
  const firstFrameRef = useRef(false);
  const onFirstFrameRef = useRef(onFirstFrame);
  onFirstFrameRef.current = onFirstFrame;

  // The user's accent (after the green rebrand, or a picked hue). On the
  // orange brand it equals the baked accent and no hue layer renders.
  // Read per render, but the timeline reads it through a ref, so a hue that
  // hydrates mid-launch never restarts the timeline.
  const liveHue = deriveAccentPalette(getCustomPrimary(), 'dark').accent;
  const hueShift = liveHue.toUpperCase() !== NATIVE_SPLASH_ACCENT;
  const hueShiftRef = useRef(hueShift);
  hueShiftRef.current = hueShift;

  // Animated values
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const inkOpacity = useRef(new Animated.Value(1)).current;
  const amp = useRef(new Animated.Value(0)).current;
  const retract = useRef(new Animated.Value(0)).current;
  const hueMix = useRef(new Animated.Value(0)).current;
  const wordmarkOpacity = useRef(new Animated.Value(0)).current;
  const wordmarkY = useRef(new Animated.Value(WORDMARK_RISE)).current;
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
    // Snap transparent before handing back (an interrupted exit or the
    // failsafe leaves overlayOpacity part-way for the unmount's commit).
    overlayOpacity.setValue(0);
    // BootShell adopts what this showed, in the commit that unmounts this.
    setSplashStage({ finished: true });
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
  // and that callback is not a guarantee: an interrupted leg reports
  // finished:false, a saturated JS thread delays it, and a native-driver
  // callback that never makes it back over the bridge simply never arrives.
  // Because this component renders a full-screen overlay ABOVE a live,
  // hydrating app rather than gating it, any of those used to leave the splash
  // painted over the home feed permanently — the deep-link cold-start bug. A
  // launch screen that outlives its purpose is a bug, so time it out
  // unconditionally (from mount, not from `live`: nothing can pin it).
  useEffect(() => {
    const failsafe = setTimeout(finish, SPLASH_MAX_LIFETIME_MS);
    return () => clearTimeout(failsafe);
  }, [finish]);

  // Resolve reduced-motion once. We deliberately latch the FIRST answer and do
  // not subscribe to later 'reduceMotionChanged' events: re-deciding the path
  // mid-launch can only interrupt what is running — it can't improve anything.
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
    // The native query is an unbounded promise; frame 0 does not wait for it,
    // but the decision "will the bubble ever move" does, so bound it.
    const t = setTimeout(() => settle(false), REDUCE_MOTION_QUERY_TIMEOUT_MS);
    return () => { active = false; clearTimeout(t); };
  }, []);

  // THE TIMELINE — from the moment the splash is live (the native splash has
  // left). Everything before it is frame 0.
  useEffect(() => {
    if (!isLive) return undefined;
    const t0 = Date.now();
    const elapsed = () => Date.now() - t0;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const running: Animated.CompositeAnimation[] = [];
    let exitStarted = false;
    let ampStarted = false;
    let alive = false;
    // Ready before ALIVE: the bubble will never move (the fast-boot rule).
    let aliveCancelled = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let graceOver = false;
    let wordmarkShown = false;
    // Signed out: the wordmark has finished rising (the fly measures it at rest).
    let wordmarkReady = false;
    let wordmarkAnim: Animated.CompositeAnimation | null = null;

    // `anim` IS the exit's last leg. Its end callback dismisses on EVERY end,
    // interrupted or not. Gating this on `finished` was the deep-link
    // cold-start bug: a stopped animation reported finished:false, the early
    // return skipped onDone(), and the overlay stayed painted over the app
    // forever at whatever opacity it had reached. The splash is never
    // load-bearing — revealing the app early is always correct, leaving it
    // covered never is.
    const endWith = (anim: Animated.CompositeAnimation) => {
      running.push(anim);
      anim.start(({ finished }) => {
        // An interrupted leg leaves the overlay part-way: clear it before the hand-back.
        if (!finished) overlayOpacity.setValue(0);
        finish();
      });
    };
    const run = (anim: Animated.CompositeAnimation) => {
      running.push(anim);
      anim.start();
    };

    // ── Coming alive (only while the app is not ready) ───────────────────────
    const startAmp = () => {
      if (ampStarted || aliveCancelled || exitStarted || doneRef.current || reduceRef.current !== false) return;
      ampStarted = true;
      const wait = Math.max(0, ALIVE_MS - elapsed());
      const total = wait + SPLASH.ampDriftMs;
      run(Animated.timing(amp, {
        toValue: 1,
        duration: total,
        easing: wait > 0 ? plateau(wait / total, easeInOutSine) : easeInOutSine,
        useNativeDriver: nativeDriver,
        isInteraction: false,
      }));
      // The stage flag flips when the drift actually leaves centre (a flag, not motion).
      const markAlive = () => {
        if (aliveCancelled || exitStarted || doneRef.current) return;
        alive = true;
        setSplashStage({ alive: true });
      };
      if (wait > 0) timers.push(setTimeout(markAlive, wait));
      else markAlive();

      if (hueShiftRef.current) {
        const hueTotal = wait + SPLASH.hueMs;
        run(Animated.timing(hueMix, {
          toValue: 1,
          duration: hueTotal,
          easing: wait > 0 ? plateau(wait / hueTotal, STANDARD) : STANDARD,
          useNativeDriver: nativeDriver,
          isInteraction: false,
        }));
        const markHue = () => { if (!aliveCancelled && !exitStarted && !doneRef.current) setSplashStage({ hue: true }); };
        if (wait > 0) timers.push(setTimeout(markHue, wait));
        else markHue();
      }
    };
    controllerRef.current = { startAmp };

    // Ready before ALIVE: stop the (still-plateaued, still 0) amp and hue timings
    // at once, even while the exit waits out its grace — one still image.
    const cancelAlive = () => {
      if (alive || aliveCancelled) return;
      aliveCancelled = true;
      amp.stopAnimation();
      hueMix.stopAnimation();
    };

    // ── The wordmark ─────────────────────────────────────────────────────────
    const showWordmark = () => {
      if (wordmarkShown || exitStarted || doneRef.current) return;
      wordmarkShown = true;
      setWordmarkOn(true);
      setSplashStage({ wordmark: true });
      const reduce = reduceRef.current === true;
      if (reduce) wordmarkY.setValue(0);
      const legs = [
        Animated.timing(wordmarkOpacity, {
          toValue: 1, duration: SPLASH.wordmarkMs, easing: DECELERATE, useNativeDriver: nativeDriver,
        }),
      ];
      if (!reduce) {
        legs.push(Animated.timing(wordmarkY, {
          toValue: 0, duration: SPLASH.wordmarkMs, easing: DECELERATE, useNativeDriver: nativeDriver,
        }));
      }
      wordmarkAnim = Animated.parallel(legs);
      run(wordmarkAnim);
      // At rest by then (a timer, not the callback, so a lost callback cannot hold the exit).
      timers.push(setTimeout(() => { wordmarkReady = true; tryExit(); }, SPLASH.wordmarkMs));
    };
    let wordmarkPending = false;
    const checkWordmark = () => {
      if (wordmarkShown || wordmarkPending || exitStarted || doneRef.current) return;
      if (getLaunchTarget()) {
        // Signed out: at max(160 ms, the moment the target registered).
        const wait = SIGNED_OUT_WORDMARK_MS - elapsed();
        if (wait <= 0) { showWordmark(); return; }
        wordmarkPending = true;
        timers.push(setTimeout(() => { wordmarkPending = false; checkWordmark(); }, wait));
      }
    };
    // Signed in: at +500 ms, only if the app is still not ready.
    timers.push(setTimeout(() => {
      if (!getBootReady() && !getLaunchTarget()) showWordmark();
      else checkWordmark();
    }, SPLASH.wordmarkAtMs));

    // ── The exits ────────────────────────────────────────────────────────────
    const fastExit = () => {
      setLaunchPhase('landed');
      endWith(Animated.timing(overlayOpacity, {
        toValue: 0, duration: EXIT.fastInkMs, easing: DECELERATE, useNativeDriver: nativeDriver,
      }));
    };

    const settleExit = () => {
      const retractTotal = EXIT.retractAtMs + EXIT.retractSpanMs; // 480
      const inkTotal = EXIT.inkAtMs + EXIT.inkMs; // 480
      // All in ONE JS tick. The settle — "level" — is the only launch moment.
      amp.stopAnimation(() => {
        run(Animated.timing(amp, {
          toValue: 0, duration: EXIT.ampMs, easing: easeOutCubic, useNativeDriver: nativeDriver,
        }));
      });
      run(Animated.timing(retract, {
        toValue: 1, duration: retractTotal, easing: plateau(EXIT.retractAtMs / retractTotal, linear), useNativeDriver: nativeDriver,
      }));
      if (wordmarkShown) {
        wordmarkAnim?.stop();
        run(Animated.timing(wordmarkOpacity, {
          toValue: 0, duration: inkTotal, easing: plateau(EXIT.inkAtMs / inkTotal, STANDARD), useNativeDriver: nativeDriver,
        }));
      }
      // Home's entrance arms on 'landed' (a flag, not motion).
      timers.push(setTimeout(() => { if (!doneRef.current) setLaunchPhase('landed'); }, EXIT.inkAtMs));
      endWith(Animated.timing(inkOpacity, {
        toValue: 0, duration: inkTotal, easing: plateau(EXIT.inkAtMs / inkTotal, STANDARD), useNativeDriver: nativeDriver,
      }));
    };

    const flyExit = (src: LaunchRect, target: LaunchRect) => {
      const k = Math.min(1, Math.max(0.15, target.width / src.width));
      flyDx.setValue((target.x + target.width / 2) - (src.x + src.width / 2));
      flyDy.setValue((target.y + target.height / 2) - (src.y + src.height / 2));
      flyDk.setValue(k - 1);
      // The level folds while the wordmark flies: settle + retract, no plateau.
      amp.stopAnimation(() => {
        run(Animated.timing(amp, {
          toValue: 0, duration: EXIT.ampMs, easing: easeOutCubic, useNativeDriver: nativeDriver,
        }));
      });
      run(Animated.timing(retract, {
        toValue: 1, duration: EXIT.retractSpanMs, easing: linear, useNativeDriver: nativeDriver,
      }));
      const inkTotal = FLY_INK_AT_MS + FLY_INK_MS;
      run(Animated.timing(inkOpacity, {
        toValue: 0, duration: inkTotal, easing: plateau(FLY_INK_AT_MS / inkTotal, easeOutCubic), useNativeDriver: nativeDriver,
      }));

      let landed = false;
      const land = () => {
        if (landed || doneRef.current) return;
        landed = true;
        // The screen's own wordmark shows beneath; this one cross-fades out.
        setLaunchPhase('landed');
        const anim = Animated.timing(flyOpacity, {
          toValue: 0, duration: FLY_FADE_MS, easing: easeOutCubic, useNativeDriver: nativeDriver,
        });
        endWith(anim);
      };
      const flight = Animated.spring(fly, { toValue: 1, ...Motion.spring.rise, useNativeDriver: nativeDriver });
      running.push(flight);
      flight.start(() => land());
      timers.push(setTimeout(land, FLY_CAP_MS));
    };

    const runExit = (src: LaunchRect | null) => {
      if (doneRef.current) return;
      setLaunchPhase('lifting');
      // The exit is bounded too: whatever its legs report, it ends by EXIT_MS.
      timers.push(setTimeout(finish, EXIT_MS + 50));
      const target = getLaunchTarget();
      if (target && src && src.width > 0 && src.height > 0) { flyExit(src, target); return; }
      // Ready before ALIVE (or the bubble never started): it never moved.
      if (!alive) {
        cancelAlive();
        fastExit();
        return;
      }
      settleExit();
    };

    const startExit = () => {
      if (exitStarted || doneRef.current) return;
      exitStarted = true;

      if (reduceRef.current === true) {
        // Reduced: nothing moves, never 'lifting', so no screen entrance arms.
        timers.push(setTimeout(finish, EXIT_MS + 50));
        endWith(Animated.timing(overlayOpacity, {
          toValue: 0, duration: EXIT.rmInkMs, easing: DECELERATE, useNativeDriver: nativeDriver,
        }));
        return;
      }

      // Measure the wordmark where it sits NOW.
      let proceeded = false;
      const go = (src: LaunchRect | null) => {
        if (proceeded) return;
        proceeded = true;
        runExit(src);
      };
      const node = (wordmarkShown ? wordmarkRef.current : null) as unknown as Measurable | null;
      if (getLaunchTarget() && node?.measureInWindow) {
        node.measureInWindow((x, y, w, h) => {
          go(w > 0 && h > 0 ? { x, y, width: w, height: h } : srcRectRef.current);
        });
        timers.push(setTimeout(() => go(srcRectRef.current), 60));
      } else {
        go(wordmarkShown ? srcRectRef.current : null);
      }
    };

    // THE HOLD — until the app is ready (+ the grace for a first screen to
    // register its wordmark). Called on every launch notify AND by the backstop.
    function tryExit() {
      if (exitStarted || doneRef.current || !getBootReady()) return;
      cancelAlive();
      if (graceTimer == null && !graceOver) {
        graceTimer = setTimeout(() => { graceOver = true; tryExit(); }, TARGET_GRACE_MS);
        timers.push(graceTimer);
      }
      const target = getLaunchTarget();
      if (!target && !graceOver) return;
      // Signed out: wait for the wordmark to be up so the fly has a source.
      if (target && reduceRef.current !== true && !wordmarkReady) { checkWordmark(); return; }
      startExit();
    }

    const onLaunchChange = () => {
      checkWordmark();
      tryExit();
    };
    const unsubscribe = subscribeLaunch(onLaunchChange);
    const backstop = setInterval(tryExit, READY_BACKSTOP_MS);
    // The probe may already have answered "motion allowed" before `live`.
    startAmp();
    onLaunchChange();

    return () => {
      controllerRef.current = null;
      unsubscribe();
      clearInterval(backstop);
      timers.forEach(clearTimeout);
      running.forEach((a) => a.stop());
    };
  }, [
    isLive, finish, overlayOpacity, inkOpacity, amp, retract, hueMix, wordmarkOpacity, wordmarkY,
    flyOpacity, fly, flyDx, flyDy, flyDk,
  ]);

  // The probe answered "motion allowed": the bubble may come alive.
  useEffect(() => {
    if (reduceMotion === false) controllerRef.current?.startAmp();
  }, [reduceMotion, isLive]);

  const onRootLayout = useCallback(() => {
    if (firstFrameRef.current) return;
    firstFrameRef.current = true;
    // One frame after the first layout: the replica is on screen.
    requestAnimationFrame(() => onFirstFrameRef.current?.());
  }, []);

  const onWordmarkLayout = useCallback(() => {
    const node = wordmarkRef.current as unknown as Measurable | null;
    node?.measureInWindow?.((x, y, w, h) => {
      if (w > 0 && h > 0) srcRectRef.current = { x, y, width: w, height: h };
    });
  }, []);

  const box = splashWordmarkBox(rect);

  return (
    <Animated.View
      style={[styles.overlay, { opacity: overlayOpacity }]}
      pointerEvents="none"
      testID="brand-splash"
      onLayout={onRootLayout}
    >
      {/* The ink field, on its own layer so it can dissolve under the fly. */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.ink, { opacity: inkOpacity }]} />
      <View
        testID="brand-splash-mark"
        style={{ position: 'absolute', left: rect.markLeft, top: rect.markTop, width: rect.markW, height: rect.markH }}
      >
        <LevelMark
          tone="splash"
          size={rect.markW}
          revealDelayMs={0}
          exit="none"
          animate={reduceMotion !== true}
          amp={amp}
          retract={retract}
          hueColor={hueShift ? liveHue : undefined}
          hueMix={hueShift ? hueMix : undefined}
        />
      </View>
      {wordmarkOn && (
        <Animated.View
          testID="brand-splash-wordmark"
          style={[styles.wordmarkBox, box, { opacity: wordmarkOpacity, transform: [{ translateY: wordmarkY }] }]}
        >
          {/* The fly wrapper's box IS the Text's box, so the fly's scale pivots on the wordmark's own centre. */}
          <Animated.View style={{ opacity: flyOpacity, transform: flyTransform }}>
            <Text ref={wordmarkRef} onLayout={onWordmarkLayout} style={styles.wordmark} numberOfLines={1}>MAGE&nbsp;ID</Text>
          </Animated.View>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  ink: {
    backgroundColor: NATIVE_SPLASH_BG,
  },
  wordmarkBox: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    // The app's display face (Barlow since the 2026-09-16 rebrand; it follows
    // Type). Falls back to the platform face if the font network-blips on first
    // launch; the wordmark still reads.
    ...Type.serifTitle, // 28 / 34 in the display face
    letterSpacing: 3.4,
    color: NATIVE_SPLASH_FG,
    textAlign: 'center',
  },
});
