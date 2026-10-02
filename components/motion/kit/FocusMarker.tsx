// FocusMarker — Status Focus Sidebar (pattern 10): ONE compact highlight that
// steps between items, each a distinct beat.
//
// components/ui/SegmentedControl.tsx's recipe on either axis. At rest there is
// NO marker: the active item paints its own fill (goldens unchanged). On a
// change ONE marker mounts at the old item and runs its two edges to the new
// one on separate springs — the leading edge on glideLead, the trailing edge on
// glideTrail — then unmounts on the frame the new item paints its own fill
// (onFlight(false) tells the host to paint it again). The marker is a view
// len0 long centred at (L + R) / 2 and scaled to R − L: transform only, native
// driver (JS-driven on the web, the SegmentedControl precedent).
//
// Reduce Motion, an unmeasured / zero-size item, or two items in different
// columns: the instant swap, no marker.

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { edgesOf, planFocusGlide, type FocusAxis, type KitRect } from '@/utils/motion/kit/focusGlide';
import { planFocusMarker, stepFor } from '@/utils/motion/kit/plans';

export type FocusRects = {
  /** The measured rects by key (one stable object; read when the active key changes). */
  rects: Record<string, KitRect>;
  onLayoutFor: (key: string) => (e: LayoutChangeEvent) => void;
};

/** Collect items' rects from onLayout (relative to their common parent). */
export function useFocusRects(): FocusRects {
  const rects = useRef<Record<string, KitRect>>({}).current;
  const handlers = useRef<Record<string, (e: LayoutChangeEvent) => void>>({}).current;
  return useMemo(() => ({
    rects,
    onLayoutFor: (key: string) => (handlers[key] ??= (e: LayoutChangeEvent) => {
      const { x, y, width, height } = e.nativeEvent.layout;
      rects[key] = { x, y, w: width, h: height };
    }),
  }), [rects, handlers]);
}

export type FocusMarkerProps = {
  axis: FocusAxis;
  activeKey: string | null;
  rects: Record<string, KitRect>;
  /** The marker's look (the host's colour, radius; a 2 pt rule passes width / left). */
  style?: StyleProp<ViewStyle>;
  /** Start the glide this long after the change (CheckSync: 60 ms after the check). */
  delayMs?: number;
  /** true when a marker mounts; false the frame it unmounts (the host repaints its own fill). */
  onFlight?: (flying: boolean) => void;
  testID?: string;
};

export function FocusMarker({ axis, activeKey, rects, style, delayMs = 0, onFlight, testID }: FocusMarkerProps) {
  const reduce = useReducedMotion();
  const lo = useRef(new Animated.Value(0)).current;
  const hi = useRef(new Animated.Value(0)).current;
  const [flight, setFlight] = useState<null | { to: KitRect; len0: number }>(null);
  const prev = useRef(activeKey);
  const flying = useRef(false);
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const cb = useRef(onFlight);
  cb.current = onFlight;

  useLayoutEffect(() => {
    const p = prev.current;
    prev.current = activeKey;
    if (p === activeKey) return;
    const plan = planFocusMarker(reduce, 0, delayMs);
    const marker = stepFor(plan, 'marker');
    const g = p != null && activeKey != null && marker ? planFocusGlide(rects[p], rects[activeKey], axis, reduce) : null;
    if (!g) {
      if (flying.current) {
        anim.current?.stop();
        flying.current = false;
        setFlight(null);
        cb.current?.(false);
      }
      return;
    }
    const from = edgesOf(g.from, axis);
    const to = edgesOf(g.to, axis);
    if (flying.current) {
      anim.current?.stop();
    } else {
      lo.setValue(from.low);
      hi.setValue(from.high);
    }
    flying.current = true;
    setFlight({ to: g.to, len0: to.high - to.low });
    cb.current?.(true);
    const wait = marker?.delayMs ?? 0;
    const a = Animated.parallel([
      Animated.sequence([Animated.delay(wait), Animated.spring(lo, { toValue: to.low, ...g.lowSpring, useNativeDriver: nativeDriver })]),
      Animated.sequence([Animated.delay(wait), Animated.spring(hi, { toValue: to.high, ...g.highSpring, useNativeDriver: nativeDriver })]),
    ]);
    anim.current = a;
    a.start(({ finished }) => {
      if (!finished) return; // superseded by a newer glide, which owns the marker now
      flying.current = false;
      setFlight(null);
      cb.current?.(false);
    });
    // `rects` is a stable object the host mutates; only the key drives a glide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  useLayoutEffect(() => () => { anim.current?.stop(); }, []);

  const len0 = flight?.len0 ?? 0;
  const transform = useMemo(() => {
    if (!(len0 > 0)) return null;
    const t = Animated.subtract(Animated.multiply(Animated.add(lo, hi), 0.5), len0 / 2);
    const s = Animated.divide(Animated.subtract(hi, lo), len0);
    return axis === 'y' ? [{ translateY: t }, { scaleY: s }] : [{ translateX: t }, { scaleX: s }];
  }, [lo, hi, len0, axis]);

  if (!flight || !transform) return null;
  const box: ViewStyle = axis === 'y'
    ? { position: 'absolute', top: 0, height: flight.len0, left: flight.to.x, width: flight.to.w }
    : { position: 'absolute', left: 0, width: flight.len0, top: flight.to.y, height: flight.to.h };
  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[box, style, { transform } as unknown as ViewStyle]}
    />
  );
}

export default FocusMarker;
