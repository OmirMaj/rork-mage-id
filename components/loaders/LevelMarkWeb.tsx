// LevelMarkWeb — "The Level" on the web, in CSS (lane WEB).
//
// WHY CSS. On react-native-web, Animated runs on requestAnimationFrame in JS
// and writes DOM styles: every Animated loader freezes exactly while the app is
// busy. Here the drift, the squash-and-stretch and the graduation glint are CSS
// keyframes on plain divs (components/loaders/css/levelCss.ts), animating
// transform and opacity only, which the browser composites off the main thread.
//
// GEOMETRY. Exactly the native mark's: levelParts(size, tone) (the splash tone
// scales the measured PNG parts with NATIVE_SPLASH_RADII_PX), the same colours
// by tone (levelPalette), pixel-snapped. Plain Views only.
//
// THE ONE COMPLETION SIGNAL (`done` false→true, exit 'settle'). CSS cannot
// multiply a running keyframe by an amplitude, so the settle freezes the live
// matrices (getComputedStyle, read synchronously in a layout effect, before
// any re-render), pins them inline, and transitions them to dead centre /
// scale(1, 1) over 280 ms; the caps and graduations take the accent at +160;
// the mark fades 140 ms from +200; onSettled fires on the container's opacity
// transitionend, backstopped at exit + 150 ms, at most once. The render is kept
// byte-stable through the settle (refs, no state), so React never re-applies
// the animation classes under it. A restart (`done` true→false) swaps the drift
// to its byte-different TWIN class and clears the inline pins, so the browser
// restarts the motion without a remount.
//
// The drift runs at FULL amplitude from mount (CSS has no amplitude to ramp);
// the reveal fade (invisible through the delay, then 170 ms) hides the join.
//
// THEME: read whole and null-safe (BrandSplash renders outside ThemeProvider).
// Reduce Motion: components/ui/motion's useReducedMotion (matchMedia on web).
// scripts/validate-level-web.ts holds the rules here.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View, type Animated, type ViewStyle } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useReducedMotion } from '@/components/ui/motion';
import { LOADER, evalRange, levelParts, retractRanges, type LevelRect } from '@/utils/levelTimeline';
import { levelPalette, splashFallbackColors } from './themeFallback';
import {
  LEVEL_BACKSTOP_MS, LEVEL_CSS, LEVEL_SETTLE, levelBeatStyle, levelDriftStyle, levelExitMs, levelRevealStyle, levelStretchStyle,
} from './css/levelCss';
import type { LevelExit, LevelMarkProps } from './LevelMark';

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

// ── DOM helpers (RN-web 0.21: a View ref IS the HTMLElement) ─────────────────

type Node = HTMLElement;
/** The ref as a DOM element, or null (native test renderers hand back no DOM). */
function dom(n: unknown): Node | null {
  const e = n as Node | null;
  return e != null && typeof e === 'object' && e.style != null && typeof e.style === 'object' ? e : null;
}
function computed(e: Node): CSSStyleDeclaration | null {
  try {
    return typeof window !== 'undefined' && typeof window.getComputedStyle === 'function' ? window.getComputedStyle(e) : null;
  } catch {
    return null;
  }
}
/** The live transform matrix; '' / 'none' (jsdom, or at rest) = the identity. */
function liveTransform(e: Node, identity: string): string {
  const t = computed(e)?.transform ?? '';
  return t && t !== 'none' ? t : identity;
}
function liveOpacity(e: Node): string {
  const o = computed(e)?.opacity ?? '';
  return o === '' ? '1' : o;
}
/** Force a style recalc so the next inline value starts a transition from here. */
function reflow(e: Node): void {
  void e.offsetWidth;
}
/** (a)+(b)+(c): freeze where it is right now, then glide to `target`. */
function freezeAndGlide(e: Node | null, target: string): void {
  if (!e) return;
  const live = liveTransform(e, target);
  e.style.animation = 'none';
  e.style.transition = 'none';
  e.style.transform = live;
  reflow(e);
  e.style.transition = LEVEL_SETTLE.glide;
  e.style.transform = target;
}
/** Freeze an opacity where it is, then transition it to `to`. Returns the live opacity. */
function freezeAndFade(e: Node | null, transition: string, to: string): number {
  if (!e) return 1;
  const live = liveOpacity(e);
  e.style.animation = 'none';
  e.style.transition = 'none';
  e.style.opacity = live;
  reflow(e);
  e.style.transition = transition;
  e.style.opacity = to;
  return Number(live);
}
function clearPins(e: Node | null): void {
  if (!e) return;
  e.style.animation = '';
  e.style.transition = '';
  e.style.transform = '';
  e.style.opacity = '';
}
/** An Animated.Value's current number (no public getter on RN's Animated.Value). */
function readValue(v: Animated.Value): number {
  const get = (v as unknown as { __getValue?: () => number }).__getValue;
  try {
    return typeof get === 'function' ? Number(get.call(v)) || 0 : 0;
  } catch {
    return 0;
  }
}

export default function LevelMarkWeb({
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
}: LevelMarkProps) {
  const theme = useTheme() as ReturnType<typeof useTheme> | undefined;
  const reduce = useReducedMotion();
  const splash = tone === 'splash';
  const colors = splash ? null : theme?.colors ?? splashFallbackColors();
  const pal = levelPalette(tone, color, colors);
  const parts = levelParts(size, tone);
  const exitKind: LevelExit = exit ?? (size < 28 ? 'fade' : 'settle');
  const moving = animate && !reduce;
  const showLvl = parts.hasLvl && moving;
  const hue = !!(hueColor && hueMix);

  // Host-driven amplitude (the splash): the drift classes only once amp rises.
  const [hostRunning, setHostRunning] = useState(false);
  const drifting = moving && (!hostAmp || hostRunning);

  // A restart after a settle picks the TWIN classes (a byte-different
  // animation-name restarts the keyframes on the same element). Counted during
  // render so the committed tree already carries the new name; idempotent
  // under StrictMode's double render (the second pass sees prev === done).
  const settleStarted = useRef(false);
  const restarts = useRef(0);
  const prevDoneRender = useRef(done);
  if (prevDoneRender.current !== done) {
    if (!done && settleStarted.current) restarts.current += 1;
    prevDoneRender.current = done;
  }
  const twin = restarts.current % 2 === 1 ? 'twin' : 'main';

  const containerRef = useRef<View>(null);
  const trackLayerRef = useRef<View>(null);
  const bubbleLayerRef = useRef<View>(null);
  const driftRef = useRef<View>(null);
  const bubbleRef = useRef<View>(null);
  const hueTrackRef = useRef<View>(null);
  const hueBubbleRef = useRef<View>(null);
  const beatRefs = useRef<(View | null)[]>([]);
  const lvlRefs = useRef<(View | null)[]>([]);

  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const settledRef = useRef(false);
  const backstopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endListener = useRef<{ node: Node; fn: (e: Event) => void } | null>(null);
  const prevDone = useRef(false);

  const disarm = () => {
    if (backstopRef.current != null) clearTimeout(backstopRef.current);
    backstopRef.current = null;
    if (endListener.current) {
      endListener.current.node.removeEventListener('transitionend', endListener.current.fn);
      endListener.current = null;
    }
  };

  // EXIT — `done` false→true: the ONE completion signal. true→false: come back.
  // A layout effect: it reads the live matrices before the browser paints and
  // before anything else re-renders.
  useLayoutEffect(() => {
    const was = prevDone.current;
    prevDone.current = done;
    if (done === was) return;
    const container = dom(containerRef.current);
    const lvlNodes = lvlRefs.current.map(dom);
    const beatNodes = beatRefs.current.map(dom);

    if (!done) {
      // Restart: loading began again while exiting. Back to full, no second
      // delay (the container keeps animation: none, so the reveal never re-runs).
      disarm();
      settledRef.current = false;
      if (!settleStarted.current) return;
      settleStarted.current = false;
      clearPins(dom(driftRef.current));
      clearPins(dom(bubbleRef.current));
      beatNodes.forEach(clearPins);
      lvlNodes.forEach((n) => {
        if (!n) return;
        n.style.transition = LEVEL_SETTLE.lvlBack;
        n.style.opacity = '0';
      });
      if (container) {
        container.style.transition = LEVEL_SETTLE.back;
        container.style.opacity = '1';
      }
      return;
    }

    if (exitKind === 'none') return;
    settledRef.current = false;
    disarm();
    const finish = () => {
      disarm();
      if (settledRef.current) return;
      settledRef.current = true;
      onSettledRef.current?.();
    };
    if (!animate) { finish(); return; }
    settleStarted.current = true;
    backstopRef.current = setTimeout(finish, levelExitMs(exitKind === 'fade' ? 'fade' : 'settle', reduce) + LEVEL_BACKSTOP_MS);
    if (container) {
      const fn = (e: Event) => {
        if (e.target === container && (e as TransitionEvent).propertyName === 'opacity') finish();
      };
      container.addEventListener('transitionend', fn);
      endListener.current = { node: container, fn };
    }

    // Still invisible (the reveal delay) → nothing to fade, no transitionend: settle now.
    const fadeOut = (transition: string) => {
      if (freezeAndFade(container, transition, '0') <= 0.001) finish();
    };
    if (reduce) { fadeOut(LEVEL_SETTLE.rm); return; }
    if (exitKind === 'fade') { fadeOut(LEVEL_SETTLE.fade); return; }

    // SETTLE (a)–(c): the bubble glides from wherever it is to dead centre.
    // With a host amp the host's own fall already ran the glide.
    if (!hostAmp) {
      freezeAndGlide(dom(driftRef.current), LEVEL_SETTLE.centre);
      freezeAndGlide(dom(bubbleRef.current), LEVEL_SETTLE.round);
      beatNodes.forEach((n) => freezeAndFade(n, LEVEL_SETTLE.beatOut, '0'));
    }
    // (d) "it's level": the caps and graduations take the accent.
    lvlNodes.forEach((n) => {
      if (!n) return;
      n.style.transition = LEVEL_SETTLE.lvl;
      n.style.opacity = '1';
    });
    // (e) the mark fades; (f) onSettled on its opacity transitionend.
    fadeOut(LEVEL_SETTLE.vis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  useEffect(() => () => disarm(), []);

  // HOST-DRIVEN VALUES (the splash on web: JS-driven Animated.Values). None of
  // this runs when the props are absent.
  const hostRunningRef = useRef(false);
  useEffect(() => {
    if (!hostAmp || !moving) return;
    let peak = 0;
    let glided = false;
    const on = (value: number) => {
      if (value > 0.01 && !hostRunningRef.current) {
        hostRunningRef.current = true;
        setHostRunning(true);
      }
      if (value > peak) peak = value;
      // amp falling towards 0 after it rose (> 0.5 once it has ramped; any
      // fall counts, so a ready during the ramp also settles) → glide ONCE.
      if (!glided && hostRunningRef.current && value < peak - 0.02) {
        glided = true;
        freezeAndGlide(dom(driftRef.current), LEVEL_SETTLE.centre);
        freezeAndGlide(dom(bubbleRef.current), LEVEL_SETTLE.round);
      }
    };
    const id = hostAmp.addListener(({ value }) => on(value));
    on(readValue(hostAmp));
    return () => hostAmp.removeListener(id);
  }, [hostAmp, moving]);

  useEffect(() => {
    if (!retract) return;
    const apply = (r: number) => {
      const t = dom(trackLayerRef.current);
      if (t) t.style.transform = `scaleX(${evalRange(retractRanges.trackScaleX, r)})`;
      const b = dom(bubbleLayerRef.current);
      if (b) {
        b.style.transform = `scale(${evalRange(retractRanges.bubbleScale, r)})`;
        b.style.opacity = String(evalRange(retractRanges.bubbleOpacity, r));
      }
    };
    const id = retract.addListener(({ value }) => apply(value));
    apply(readValue(retract));
    return () => retract.removeListener(id);
  }, [retract]);

  useEffect(() => {
    if (!hueMix || !hue) return;
    const apply = (m: number) => {
      const o = String(Math.max(0, Math.min(1, m)));
      const a = dom(hueTrackRef.current);
      if (a) a.style.opacity = o;
      const b = dom(hueBubbleRef.current);
      if (b) b.style.opacity = o;
    };
    const id = hueMix.addListener(({ value }) => apply(value));
    apply(readValue(hueMix));
    return () => hueMix.removeListener(id);
  }, [hueMix, hue]);

  // pointerEvents in the style (RN-web deprecates the prop).
  const boxStyle: ViewStyle = { width: snap(parts.boxW), height: snap(parts.boxH), pointerEvents: 'none' };
  const hide = {
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants' as const,
  };

  // STATIC (animate={false}): a still, centred level, no classes.
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

  const reveal = revealDelayMs > 0 ? levelRevealStyle(revealDelayMs) : null;
  const driftClass = drifting ? levelDriftStyle(parts.amp, twin) : null;
  const bubbleClass = reduce ? LEVEL_CSS.breath : drifting ? levelStretchStyle(parts.stretch, parts.squash, twin) : null;
  const beatClass = drifting && parts.grads ? levelBeatStyle(twin) : null;

  const trackLayer = (
    <>
      {parts.capL && <View style={rect(parts.capL, pal.cap, parts.capOpacity)} />}
      {parts.capR && <View style={rect(parts.capR, pal.cap, parts.capOpacity)} />}
      {showLvl && parts.capL && (
        <View ref={(n) => { lvlRefs.current[0] = n; }} style={[rect(parts.capL, pal.lvl), styles.off]} />
      )}
      {showLvl && parts.capR && (
        <View ref={(n) => { lvlRefs.current[1] = n; }} style={[rect(parts.capR, pal.lvl), styles.off]} />
      )}
      <View testID={`${testID}-track`} style={rect(parts.track, pal.track, parts.trackOpacity)} />
      {hue && (
        <View ref={hueTrackRef} style={[StyleSheet.absoluteFill, styles.off]}>
          <View style={rect(parts.track, hueColor!, parts.trackOpacity)} />
        </View>
      )}
    </>
  );

  const b = parts.bubble;
  const bubbleLayer = (
    <View ref={driftRef} testID={`${testID}-drift`} style={[StyleSheet.absoluteFill, driftClass]}>
      <View ref={bubbleRef} testID={`${testID}-bubble`} style={[rect(b, pal.bubble), bubbleClass]}>
        {hue && (
          <View
            ref={hueBubbleRef}
            style={[StyleSheet.absoluteFill, { borderRadius: snap(b.radius), backgroundColor: hueColor }, styles.off]}
          />
        )}
      </View>
    </View>
  );

  return (
    <View ref={containerRef} testID={testID} style={[boxStyle, reveal]} {...hide}>
      {retract ? (
        <View ref={trackLayerRef} style={StyleSheet.absoluteFill}>{trackLayer}</View>
      ) : trackLayer}
      {parts.grads?.map((g, i) => <View key={`g${i}`} style={rect(g, pal.grad, parts.gradOpacity)} />)}
      {beatClass && parts.grads?.map((g, i) => (
        <View key={`b${i}`} ref={(n) => { beatRefs.current[i] = n; }} style={[rect(g, pal.beat), beatClass]} />
      ))}
      {showLvl && parts.grads?.map((g, i) => (
        <View key={`l${i}`} ref={(n) => { lvlRefs.current[2 + i] = n; }} style={[rect(g, pal.lvl), styles.off]} />
      ))}
      {retract ? (
        <View ref={bubbleLayerRef} style={StyleSheet.absoluteFill}>{bubbleLayer}</View>
      ) : bubbleLayer}
    </View>
  );
}

const styles = StyleSheet.create({
  off: { opacity: 0 },
});
