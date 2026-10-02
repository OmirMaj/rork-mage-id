// FileInto / useFileInto — Folder Grid Filing (pattern 6).
//
// Folders stay anchored; the documents that REALLY landed fly into their
// folder. The host calls fileInto({ sources, target, thumbs }) only after the
// pages / files really landed (a scan saved, an upload resolved) — a queued
// offline write never flies; the host's queued line shows instead.
//
// ONE measurement batch (measureInWindow for the layer itself, every source and
// the target — the layer first, so its answer is in before theirs), then up to
// 3 proxy thumbs travel in <FileIntoLayer> (rendered ONCE, pointerEvents none,
// at the screen root or inside the host's own frame) from their source to the target's
// centre, scaling to max(targetW / sourceW, 0.3) on Motion.spring.sheet
// (ζ 1.006, no overshoot), 60 ms apart, each fading over its last 120 ms. More
// than 3: a '+N' chip flies with the 3rd. The folder "receives" when the first
// flyer arrives — scale 1 → 1.04 → 1 on snap (receiveStyle, for the host's
// folder Animated.View) — and onReceive fires so the host steps its count.
//
// Placement (lane KITFIX, KG1): the layer is absoluteFill inside its host, and
// the host is rarely at the window's origin (a stack header, a modal sheet, the
// desktop sidebar, a scrolled container). Each flyer's box starts at
// source − the layer's own window origin (flyerGeometry in utils/motion/kit/
// plans.ts), so it lands exactly on the target wherever the layer sits. A layer
// that cannot be measured counts as (0, 0) — the shipped behaviour.
//
// Fallback (a measure failed, Reduce Motion, a refused budget): no flyers;
// onReceive fires at once and the host's "Filed to <folder>" line carries it.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { motionCurve, nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { KIT_CAPS, KIT_SCALE, KIT_SPRING } from '@/utils/motion/kit/kitSpec';
import { FLYER_FADE_MS, flyerGeometry, planFileInto, stepFor, type KitPoint } from '@/utils/motion/kit/plans';
import { plateauEase, plateauFraction } from '@/utils/motion/kit/stagger';
import { kitFlight } from './css/kitCss';
import { acquire } from './budget';

export type Measurable = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void };
export type MeasureRef = { current: Measurable | null };

export type FileIntoArgs = {
  sources: readonly MeasureRef[];
  target: MeasureRef;
  /** One thumb per source (a small picture of the page / file). */
  thumbs: readonly React.ReactNode[];
  /** The folder received: step its count now. */
  onReceive?: () => void;
};

type Rect = { x: number; y: number; w: number; h: number };
type Flyer = { from: Rect; dx: number; dy: number; scale: number; delayMs: number; node: React.ReactNode; chip: number | null };
type Flight = { id: number; flyers: Flyer[]; travelMs: number };

const okRect = (r: Rect | null): r is Rect => !!r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0;

function measure(ref: MeasureRef | null | undefined): Promise<Rect | null> {
  return new Promise((resolve) => {
    const m = ref?.current;
    if (!m || typeof m.measureInWindow !== 'function') { resolve(null); return; }
    try {
      m.measureInWindow((x, y, w, h) => resolve({ x, y, w, h }));
    } catch {
      resolve(null);
    }
  });
}

export type UseFileIntoOptions = { chipStyle?: StyleProp<ViewStyle>; chipTextStyle?: StyleProp<TextStyle> };

export function useFileInto(opts: UseFileIntoOptions = {}): {
  fileInto: (a: FileIntoArgs) => Promise<boolean>;
  layer: React.ReactNode;
  receiveStyle: ViewStyle | null;
} {
  const reduce = useReducedMotion();
  const [flight, setFlight] = useState<Flight | null>(null);
  const [receiving, setReceiving] = useState(false);
  const recv = useRef(new Animated.Value(1)).current;
  const ids = useRef(0);
  const layerRef = useRef<View>(null);
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;

  const fileInto = useCallback(async (a: FileIntoArgs): Promise<boolean> => {
    const plan = planFileInto(reduceRef.current, a.sources.length);
    const first = stepFor(plan, 'flyer-0');
    const fallback = () => { a.onReceive?.(); return false; };
    if (!first) return fallback();
    // ONE measurement batch: every read before anything is written. The layer
    // asks first: measureInWindow answers in the order it is asked (a FIFO
    // bridge / a 0 ms timer on the web), so by the time the target and the
    // sources are in, so is the layer. A layer that never answers (a test
    // renderer's mock) is (0, 0), the shipped behaviour.
    let origin: KitPoint | null = null;
    try {
      layerRef.current?.measureInWindow?.((x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) origin = { x, y }; });
    } catch {
      origin = null;
    }
    const n = Math.min(a.sources.length, KIT_CAPS.flyers);
    const [target, ...sources] = await Promise.all([
      measure(a.target),
      ...a.sources.slice(0, n).map((s) => measure(s)),
    ]);
    if (!okRect(target) || sources.some((s) => !okRect(s))) return fallback();
    const granted = acquire(n, first.durationMs + (n - 1) * (stepFor(plan, 'flyer-1')?.delayMs ?? 0));
    if (granted === 0) return fallback();
    // Window rects → the layer's own coordinates (the origin cancels in dx / dy).
    const layerOrigin: KitPoint | null = origin;
    const flyers: Flyer[] = (sources as Rect[]).slice(0, granted).map((s, i) => {
      const step = stepFor(plan, `flyer-${i}`);
      const extra = a.sources.length - n;
      const g = flyerGeometry(s, target, layerOrigin);
      return {
        from: { x: g.left, y: g.top, w: g.w, h: g.h },
        dx: g.dx,
        dy: g.dy,
        scale: g.scale,
        delayMs: step?.delayMs ?? 0,
        node: a.thumbs[i] ?? null,
        chip: i === n - 1 && extra > 0 ? extra : null,
      };
    });
    ids.current += 1;
    setFlight({ id: ids.current, flyers, travelMs: first.durationMs });
    // The folder receives when the first flyer arrives.
    const folder = stepFor(plan, 'folder');
    setReceiving(true);
    recv.setValue(1);
    Animated.sequence([
      Animated.delay(folder?.delayMs ?? first.durationMs),
      Animated.spring(recv, { toValue: KIT_SCALE.receive, ...KIT_SPRING.snap, useNativeDriver: nativeDriver }),
    ]).start(() => {
      a.onReceive?.();
      Animated.spring(recv, { toValue: 1, ...KIT_SPRING.snap, useNativeDriver: nativeDriver }).start(({ finished }) => {
        if (finished) setReceiving(false);
      });
    });
    return true;
  }, [recv]);

  const done = useCallback((id: number) => setFlight((f) => (f && f.id === id ? null : f)), []);

  const layer = (
    <View ref={layerRef} pointerEvents="none" style={StyleSheet.absoluteFill} testID="file-into-layer">
      {flight ? <FlightView key={flight.id} flight={flight} onDone={done} chipStyle={opts.chipStyle} chipTextStyle={opts.chipTextStyle} /> : null}
    </View>
  );
  const receiveStyle = useMemo(() => (receiving ? ({ transform: [{ scale: recv }] } as unknown as ViewStyle) : null), [receiving, recv]);
  return { fileInto, layer, receiveStyle };
}

function FlightView({ flight, onDone, chipStyle, chipTextStyle }: { flight: Flight; onDone: (id: number) => void; chipStyle?: StyleProp<ViewStyle>; chipTextStyle?: StyleProp<TextStyle> }) {
  const reduce = useReducedMotion();
  // planFileInto is the source of every number below; read here so a Reduce
  // Motion flip mid-flight ends the flight at once.
  const plan = planFileInto(reduce, flight.flyers.length);
  const web = Platform.OS === 'web';
  const values = useRef(flight.flyers.map(() => ({ p: new Animated.Value(0), o: new Animated.Value(0) }))).current;
  const started = useRef(false);
  const total = flight.travelMs + (flight.flyers[flight.flyers.length - 1]?.delayMs ?? 0);

  React.useLayoutEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!stepFor(plan, 'flyer-0')) { onDone(flight.id); return; }
    if (web) {
      // The CSS runs on the compositor; a detached clock clears the layer.
      Animated.timing(new Animated.Value(0), { toValue: 1, duration: total, useNativeDriver: nativeDriver, isInteraction: false })
        .start(() => onDone(flight.id));
      return;
    }
    const anims = flight.flyers.map((f, i) => Animated.parallel([
      Animated.sequence([
        Animated.delay(f.delayMs),
        Animated.spring(values[i].p, { toValue: 1, ...KIT_SPRING.sheet, useNativeDriver: nativeDriver }),
      ]),
      Animated.timing(values[i].o, {
        toValue: 1,
        duration: f.delayMs + flight.travelMs,
        easing: plateauEase(plateauFraction(f.delayMs + flight.travelMs - FLYER_FADE_MS, FLYER_FADE_MS), motionCurve.in),
        useNativeDriver: nativeDriver,
      }),
    ]));
    Animated.parallel(anims).start(() => onDone(flight.id));
  });

  return (
    <>
      {flight.flyers.map((f, i) => {
        const box: ViewStyle = { position: 'absolute', left: f.from.x, top: f.from.y, width: f.from.w, height: f.from.h };
        const motion: StyleProp<ViewStyle> = web
          ? [{ opacity: 0 }, kitFlight(f.dx, f.dy, f.scale, flight.travelMs, f.delayMs, FLYER_FADE_MS)]
          : ({
              opacity: values[i].o.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' }),
              transform: [
                { translateX: values[i].p.interpolate({ inputRange: [0, 1], outputRange: [0, f.dx], extrapolate: 'clamp' }) },
                { translateY: values[i].p.interpolate({ inputRange: [0, 1], outputRange: [0, f.dy], extrapolate: 'clamp' }) },
                { scale: values[i].p.interpolate({ inputRange: [0, 1], outputRange: [1, f.scale], extrapolate: 'clamp' }) },
              ],
            } as unknown as ViewStyle);
        return (
          <Animated.View key={i} testID={`file-into-flyer-${i}`} style={[box, motion]}>
            {f.node}
            {f.chip != null ? (
              <View testID="file-into-chip" style={[styles.chip, chipStyle]}>
                <Text style={chipTextStyle}>{`+${f.chip}`}</Text>
              </View>
            ) : null}
          </Animated.View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  chip: { position: 'absolute', right: -6, top: -6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
});

/** The layer as a component, for hosts that prefer JSX: render the hook's `layer` instead. */
export function FileIntoLayer({ layer }: { layer: React.ReactNode }) {
  return <>{layer}</>;
}
