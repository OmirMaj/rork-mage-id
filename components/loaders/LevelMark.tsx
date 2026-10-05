// LevelMark — "The Level", MAGE ID's one loading mark: the spirit level the
// baked native splash already shows. The bubble SEEKS (a liquid sine drift with
// squash-and-stretch) while work runs and SETTLES dead centre only when the
// work is truly done (`done` false→true) — the app's single "ready" signal.
//
// NATIVE: plain Views only (no react-native-svg, no createAnimatedComponent).
// The drift reads the ONE shared clock (levelClock.ts) through pre-sampled
// 25-point ranges (utils/levelTimeline.ts) multiplied by a per-instance `amp`,
// so every node is on the native driver and a pegged JS thread cannot stall
// it. Only `amp`, `vis` and `lvl` are ever animated per instance; the shared
// clock is never stopped or reset here (only `amp` settles).
//
// WEB: delegates to LevelMarkWeb (CSS motion; the WEB lane owns it). Platform
// is read at RENDER, never at module scope (the golden harness flips it).
//
// THEME: null-safe. BrandSplash renders OUTSIDE ThemeProvider, where useTheme()
// returns undefined — so the theme is read whole and with `?.`, falling back to
// splashFallbackColors(). scripts/validate-level.ts holds every rule here.

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, PixelRatio, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { nativeDriver, useReducedMotion } from '@/components/ui/motion';
import {
  ACCELERATE, DECELERATE, LOADER, beatRange, driftUnit, easeInOutSine, easeOutCubic, enterTimings,
  levelInput, levelParts, linear, plateau, retractRanges, rmBreath, speedUnit, type LevelRect,
} from '@/utils/levelTimeline';
import { levelPartsDesk } from '@/utils/levelDesk';
import { GATE_LOST_CALLBACK_MS } from '@/utils/loadingGate';
import { useLevelClock } from './levelClock';
import { levelPalette, splashFallbackColors, type LevelTone } from './themeFallback';
import LevelMarkWeb from './LevelMarkWeb';

export type { LevelTone };
export type LevelExit = 'settle' | 'fade' | 'none';

export interface LevelMarkProps {
  /** Drawn width in pt (tone 'splash': splashRect's markW). */
  size: number;
  /** false → a static level, bubble centred, no clock subscription. */
  animate?: boolean;
  /**
   * accent (default) | onAccent (inside a filled button: everything in `color`)
   * | muted | splash. The SPLASH tone draws the native PNG's parts with the
   * NATIVE_SPLASH_* literals and reads no theme token. It does not special-case
   * Reduce Motion: the splash hosts (BootShell, BrandSplash) pass
   * animate={false} under Reduce Motion, so the replica is a still frame
   * identical to the PNG (no breath, no clock).
   */
  tone?: LevelTone;
  /** Overrides the bubble colour (onAccent: bubble, caps and track). */
  color?: string;
  /** false→true plays the ONE exit. true→false (a restart) brings it back. */
  done?: boolean;
  /** Default: 'fade' below 28 pt, else 'settle'. 'none' = the host drives the exit. */
  exit?: LevelExit;
  /** The plateau before the enter; 0 = fully visible on frame 0 (splash replica). */
  revealDelayMs?: number;
  /** After the exit (a backstop guarantees it; called at most once per exit). */
  onSettled?: () => void;
  /** Host-owned amplitude (splash): disables the internal amp enter/settle. */
  amp?: Animated.Value;
  /** Splash exit channel r 0→1 (retractRanges). */
  retract?: Animated.Value;
  /** Splash hue layer: a second bubble + track in hueColor at opacity hueMix. */
  hueColor?: string;
  hueMix?: Animated.Value;
  testID?: string;
  /**
   * The wide-canvas table (utils/levelDesk.ts levelPartsDesk): widths past 120
   * keep growing (the table to 240, then in proportion to 640) instead of
   * centring a 120 mark. Identical to the phone
   * table at ≤ 120 and for the splash tone. Default false.
   */
  desk?: boolean;
}

const snap = (v: number) => PixelRatio.roundToNearestPixel(v);

function rect(r: LevelRect, bg: string, opacity?: number): ViewStyle {
  return {
    position: 'absolute',
    left: snap(r.left),
    top: snap(r.top),
    width: Math.max(1, snap(r.width)),
    height: Math.max(1, snap(r.height)),
    borderRadius: snap(r.radius),
    backgroundColor: bg,
    ...(opacity != null && opacity !== 1 ? { opacity } : null),
  };
}

export default function LevelMark(props: LevelMarkProps) {
  if (Platform.OS === 'web') return <LevelMarkWeb {...props} />;
  return <LevelMarkNative {...props} />;
}

function exitMsFor(kind: LevelExit, reduce: boolean): number {
  if (reduce) return LOADER.rmSettleMs;
  if (kind === 'fade') return LOADER.fadeExitMs;
  return LOADER.settle.visAtMs + LOADER.settle.visMs;
}

function LevelMarkNative({
  size,
  animate = true,
  tone = 'accent',
  color,
  done = false,
  exit,
  revealDelayMs = LOADER.enter.defaultRevealMs,
  onSettled,
  amp: hostAmp,
  retract,
  hueColor,
  hueMix,
  testID = 'level-mark',
  desk = false,
}: LevelMarkProps) {
  const theme = useTheme() as ReturnType<typeof useTheme> | undefined;
  const reduce = useReducedMotion();
  const clock = useLevelClock(animate);
  const splash = tone === 'splash';
  const colors = splash ? null : theme?.colors ?? splashFallbackColors();
  const pal = levelPalette(tone, color, colors);
  const parts = useMemo(() => (desk ? levelPartsDesk(size, tone) : levelParts(size, tone)), [size, tone, desk]);

  // Per-instance values. vis starts hidden when there is a reveal plateau.
  const vis = useRef(new Animated.Value(revealDelayMs > 0 ? 0 : 1)).current;
  const amp = useRef(new Animated.Value(0)).current;
  const lvl = useRef(new Animated.Value(0)).current;
  const drive = hostAmp ?? amp;

  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const settledRef = useRef(false);
  const backstopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevDone = useRef(false);

  const exitKind: LevelExit = exit ?? (size < 28 ? 'fade' : 'settle');
  const showLvl = parts.hasLvl && !reduce && animate;

  // ENTER — every time the mark starts animating (mount, or animate false→true).
  useEffect(() => {
    if (!animate || done) return;
    const anims: Animated.CompositeAnimation[] = [];
    const e = enterTimings(revealDelayMs);
    if (revealDelayMs > 0) {
      vis.setValue(0);
      anims.push(Animated.timing(vis, {
        toValue: 1, duration: e.visTotal, easing: plateau(e.visPlateau, DECELERATE), useNativeDriver: nativeDriver,
      }));
    }
    if (!hostAmp && !reduce) {
      amp.setValue(0);
      anims.push(Animated.timing(amp, {
        toValue: 1, duration: e.ampTotal, easing: plateau(e.ampPlateau, easeInOutSine), useNativeDriver: nativeDriver,
      }));
    }
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, reduce]);

  // EXIT — `done` false→true: the ONE completion signal. true→false: come back.
  useEffect(() => {
    const was = prevDone.current;
    prevDone.current = done;
    if (done === was) return;
    const clearBackstop = () => {
      if (backstopRef.current != null) clearTimeout(backstopRef.current);
      backstopRef.current = null;
    };
    if (!done) {
      // Restart: loading began again while exiting. Back to full, no second delay.
      clearBackstop();
      settledRef.current = false;
      if (!animate) return;
      Animated.timing(vis, { toValue: 1, duration: LOADER.enter.visFadeMs, easing: DECELERATE, useNativeDriver: nativeDriver }).start();
      if (showLvl) Animated.timing(lvl, { toValue: 0, duration: LOADER.settle.lvlMs, easing: linear, useNativeDriver: nativeDriver }).start();
      if (!hostAmp && !reduce) {
        Animated.timing(amp, { toValue: 1, duration: LOADER.enter.ampDriftMs, easing: easeInOutSine, useNativeDriver: nativeDriver }).start();
      }
      return;
    }
    if (exitKind === 'none') return;
    settledRef.current = false;
    const finish = () => {
      clearBackstop();
      if (settledRef.current) return;
      settledRef.current = true;
      onSettledRef.current?.();
    };
    // A lost completion callback must never strand the host: the backstop
    // finishes the exit itself at exitMs + 150, timed from when the exit
    // ACTUALLY starts. Every path below starts it in this tick except the
    // settle behind amp.stopAnimation — an async native round trip that lands
    // exactly as the content mounts and JS stalls — so that path holds only a
    // lost-callback backstop here and re-arms the exact one inside startSettle.
    const exitMs = exitMsFor(exitKind, reduce);
    const armBackstop = (ms: number) => {
      clearBackstop();
      backstopRef.current = setTimeout(finish, ms);
    };
    if (!animate) { finish(); return; }
    const onVisDone = ({ finished }: { finished: boolean }) => { if (finished) finish(); };
    if (reduce) {
      armBackstop(exitMs + 150);
      Animated.timing(vis, { toValue: 0, duration: LOADER.rmSettleMs, easing: ACCELERATE, useNativeDriver: nativeDriver }).start(onVisDone);
      return;
    }
    if (exitKind === 'fade') {
      armBackstop(exitMs + 150);
      Animated.timing(vis, { toValue: 0, duration: LOADER.fadeExitMs, easing: ACCELERATE, useNativeDriver: nativeDriver }).start(onVisDone);
      return;
    }
    // SETTLE: amp damps into dead centre while the shared clock keeps running;
    // the caps + graduations take the accent; the mark fades. All in ONE tick.
    const S = LOADER.settle;
    const startSettle = (withAmp: boolean) => {
      // A late callback after the backstop finished, or after a restart
      // (done went false again while stopAnimation was in flight), plays nothing.
      if (settledRef.current || !prevDone.current) return;
      armBackstop(exitMs + 150); // settle start + 340 + 150
      if (withAmp) {
        Animated.timing(amp, { toValue: 0, duration: S.ampMs, easing: easeOutCubic, useNativeDriver: nativeDriver }).start();
      }
      if (showLvl) {
        const total = S.lvlAtMs + S.lvlMs;
        Animated.timing(lvl, { toValue: 1, duration: total, easing: plateau(S.lvlAtMs / total, linear), useNativeDriver: nativeDriver }).start();
      }
      const visTotal = S.visAtMs + S.visMs;
      Animated.timing(vis, { toValue: 0, duration: visTotal, easing: plateau(S.visAtMs / visTotal, ACCELERATE), useNativeDriver: nativeDriver }).start(onVisDone);
    };
    if (hostAmp) startSettle(false);
    else {
      armBackstop(exitMs + GATE_LOST_CALLBACK_MS);
      amp.stopAnimation(() => startSettle(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  useEffect(() => () => {
    if (backstopRef.current != null) clearTimeout(backstopRef.current);
  }, []);

  // The clock-driven nodes, memoised on (clock, geometry, amp source).
  const nodes = useMemo(() => {
    if (!clock) return null;
    if (reduce) {
      // Reduce Motion: no transform at all (amp pinned 0); the bubble breathes.
      return { breath: clock.interpolate({ inputRange: levelInput, outputRange: rmBreath, extrapolate: 'clamp' }) };
    }
    const ch = (unit: number[], k: number) => clock.interpolate({
      inputRange: levelInput, outputRange: unit.map((v) => v * k), extrapolate: 'clamp',
    });
    const translateX = Animated.multiply(ch(driftUnit, parts.amp), drive);
    const scaleX = Animated.add(1, Animated.multiply(ch(speedUnit, parts.stretch), drive));
    const scaleY = Animated.add(1, Animated.multiply(ch(speedUnit, -parts.squash), drive));
    const beat = parts.grads ? Animated.multiply(clock.interpolate({ ...beatRange, extrapolate: 'clamp' }), drive) : null;
    return { transform: [{ translateX }, { scaleX }, { scaleY }], beat };
  }, [clock, reduce, parts, drive]);

  const retractNodes = useMemo(() => (retract ? {
    trackScaleX: retract.interpolate({ ...retractRanges.trackScaleX, extrapolate: 'clamp' }),
    bubbleScale: retract.interpolate({ ...retractRanges.bubbleScale, extrapolate: 'clamp' }),
    bubbleOpacity: retract.interpolate({ ...retractRanges.bubbleOpacity, extrapolate: 'clamp' }),
  } : null), [retract]);

  const boxStyle: ViewStyle = { width: snap(parts.boxW), height: snap(parts.boxH) };
  const hide = {
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants' as const,
    pointerEvents: 'none' as const,
  };

  // STATIC: no clock, no animated nodes, bubble centred, fully visible.
  if (!animate) {
    return (
      <View testID={testID} style={boxStyle} {...hide}>
        {parts.capL && <View style={rect(parts.capL, pal.cap, parts.capOpacity)} />}
        {parts.capR && <View style={rect(parts.capR, pal.cap, parts.capOpacity)} />}
        <View testID={`${testID}-track`} style={rect(parts.track, pal.track, parts.trackOpacity)} />
        {parts.grads?.map((g, i) => <View key={i} style={rect(g, pal.grad, parts.gradOpacity)} />)}
        <View testID={`${testID}-bubble`} style={rect(parts.bubble, pal.bubble)} />
      </View>
    );
  }

  const bubbleMotion: Animated.WithAnimatedValue<ViewStyle> | null = nodes
    ? ('breath' in nodes ? { opacity: nodes.breath } : { transform: nodes.transform })
    : null;

  const trackLayer = (
    <>
      {parts.capL && <View style={rect(parts.capL, pal.cap, parts.capOpacity)} />}
      {parts.capR && <View style={rect(parts.capR, pal.cap, parts.capOpacity)} />}
      {showLvl && parts.capL && <Animated.View style={[rect(parts.capL, pal.lvl), { opacity: lvl }]} />}
      {showLvl && parts.capR && <Animated.View style={[rect(parts.capR, pal.lvl), { opacity: lvl }]} />}
      <View testID={`${testID}-track`} style={rect(parts.track, pal.track, parts.trackOpacity)} />
      {hueColor && hueMix && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: hueMix }]}>
          <View style={rect(parts.track, hueColor, parts.trackOpacity)} />
        </Animated.View>
      )}
    </>
  );

  const bubbleLayer = (
    <>
      <Animated.View testID={`${testID}-bubble`} style={[rect(parts.bubble, pal.bubble), bubbleMotion]} />
      {hueColor && hueMix && (
        <Animated.View
          style={[rect(parts.bubble, hueColor), nodes && 'transform' in nodes ? { transform: nodes.transform, opacity: hueMix } : { opacity: hueMix }]}
        />
      )}
    </>
  );

  return (
    <View testID={testID} style={boxStyle} {...hide}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: vis }]}>
        {retractNodes ? (
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scaleX: retractNodes.trackScaleX }] }]}>{trackLayer}</Animated.View>
        ) : trackLayer}
        {parts.grads?.map((g, i) => <View key={`g${i}`} style={rect(g, pal.grad, parts.gradOpacity)} />)}
        {nodes && 'beat' in nodes && nodes.beat && parts.grads?.map((g, i) => (
          <Animated.View key={`b${i}`} style={[rect(g, pal.beat), { opacity: nodes.beat! }]} />
        ))}
        {showLvl && parts.grads?.map((g, i) => (
          <Animated.View key={`l${i}`} style={[rect(g, pal.lvl), { opacity: lvl }]} />
        ))}
        {retractNodes ? (
          <Animated.View
            style={[StyleSheet.absoluteFill, { opacity: retractNodes.bubbleOpacity, transform: [{ scale: retractNodes.bubbleScale }] }]}
          >
            {bubbleLayer}
          </Animated.View>
        ) : bubbleLayer}
      </Animated.View>
    </View>
  );
}

/**
 * A wrapper opacity that shares the mark's reveal plateau + fade (and its exit
 * fade on `done`), for the words a host shows beside a level. Native driver;
 * the web returns 1 (web motion is CSS, owned by the WEB lane).
 */
export function useLevelReveal(revealDelayMs: number, done = false, exit: LevelExit = 'settle'): Animated.Value | 1 {
  const web = Platform.OS === 'web';
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(revealDelayMs > 0 ? 0 : 1)).current;
  useEffect(() => {
    if (web || revealDelayMs <= 0) return;
    const e = enterTimings(revealDelayMs);
    const a = Animated.timing(v, { toValue: 1, duration: e.visTotal, easing: plateau(e.visPlateau, DECELERATE), useNativeDriver: nativeDriver });
    a.start();
    return () => a.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const prev = useRef(done);
  useEffect(() => {
    const was = prev.current;
    prev.current = done;
    if (web || done === was || exit === 'none') return;
    if (!done) {
      Animated.timing(v, { toValue: 1, duration: LOADER.enter.visFadeMs, easing: DECELERATE, useNativeDriver: nativeDriver }).start();
      return;
    }
    const S = LOADER.settle;
    const total = reduce ? LOADER.rmSettleMs : exit === 'fade' ? LOADER.fadeExitMs : S.visAtMs + S.visMs;
    const d = reduce || exit === 'fade' ? 0 : S.visAtMs / total;
    Animated.timing(v, { toValue: 0, duration: total, easing: plateau(d, ACCELERATE), useNativeDriver: nativeDriver }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  return web ? 1 : v;
}
