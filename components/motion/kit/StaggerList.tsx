// StaggerList / useStagger — Sequential List Reveal (pattern 8).
//
// New rows lay themselves down: opacity 0→1 + translateY 8→0 over 220 ms,
// 35 ms apart, for the first 8 NEW rows; every row past that lands with no
// motion at all. The longest entrance is 7·35 + 220 = 465 ms, then the list
// HOLDS (nothing loops). Rows already on screen before the change never
// animate (`initialCount`, and every key this host has shown before).
//
// renderItem receives the row's entrance style; the host puts it on an
// Animated.View it renders (null at rest, so the tree is unchanged).
//
// Do NOT combine with <SkeletonReveal> + revealStagger on one list: the loader
// hand-off already staggers (validate-motion-kit K4.11).
//
// Reduce Motion: every armed row fades in together over 100 ms.
// Web (desktop): the rise8 class with its delay as a string.

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Animated, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { motionCurve, nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import { KIT_STAGGER } from '@/utils/motion/kit/kitSpec';
import { entranceOf, planStaggerList, type PlanStep } from '@/utils/motion/kit/plans';
import { plateauEase, plateauFraction, sequenceMs } from '@/utils/motion/kit/stagger';
import { kitWebStyle } from './css/kitCss';
import { acquire, release } from './budget';
import { useEntrance } from './useEntrance';
import { useSeenKeys } from './useSeenKeys';

// ── useStagger: one hook for a host that renders its own rows ────────────────

type StaggerRun = { styles: (ViewStyle | null)[]; values: Animated.Value[]; granted: number; at: number; total: number; started: boolean; done: boolean; anim: Animated.CompositeAnimation | null };

/**
 * (i) => row i's entrance style (null at rest, past the cap, after the run, or
 * when the budget refused it). Arms once per mount on the first `armed`.
 */
export function useStagger(o: { armed: boolean; count: number; cap?: number; desktopWebOnly?: boolean }): (i: number) => ViewStyle | null {
  const reduce = useReducedMotion();
  const desktopWeb = useIsDesktopWeb();
  const cap = o.cap ?? KIT_STAGGER.cap;
  const run = useRef<StaggerRun | null>(null);
  const web = Platform.OS === 'web';

  if (o.armed && !run.current) {
    const plan = planStaggerList(reduce, o.count, cap);
    const moving = plan.steps.filter((s) => s.durationMs > 0);
    const total = reduce ? plan.steps[0]?.durationMs ?? 0 : sequenceMs(o.count, cap);
    const webOff = web && (reduce || (o.desktopWebOnly !== false && !desktopWeb));
    const granted = webOff ? 0 : acquire(moving.length, total);
    const r: StaggerRun = { styles: [], values: [], granted, at: Date.now(), total, started: false, done: granted === 0, anim: null };
    moving.slice(0, granted).forEach((s, i) => {
      if (web) { r.styles.push(kitWebStyle('rise8', s.delayMs)); return; }
      const v = new Animated.Value(0);
      r.values.push(v);
      const e = entranceOf(s);
      r.styles.push((e.fromY
        ? { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [e.fromY, 0], extrapolate: 'clamp' }) }] }
        : { opacity: v }) as unknown as ViewStyle);
    });
    run.current = r;
  }

  useLayoutEffect(() => {
    const r = run.current;
    if (!r || r.started || web) return;
    r.started = true;
    if (r.values.length === 0) { r.done = true; return; }
    const plan = planStaggerList(reduce, o.count, cap);
    const anims = r.values.map((v, i) => {
      const s: PlanStep = plan.steps[i];
      return Animated.timing(v, {
        toValue: 1,
        duration: s.delayMs + s.durationMs,
        easing: plateauEase(plateauFraction(s.delayMs, s.durationMs), motionCurve.out),
        useNativeDriver: nativeDriver,
      });
    });
    const all = Animated.parallel(anims);
    r.anim = all;
    all.start(() => { r.done = true; release(r.granted); });
  });
  useEffect(() => () => { run.current?.anim?.stop(); }, []);

  const r = run.current;
  return (i: number) => {
    if (!r || r.done || i < 0 || i >= r.styles.length) return null;
    if (web && Date.now() - r.at >= r.total) return null;
    return r.styles[i];
  };
}

// ── StaggerList ──────────────────────────────────────────────────────────────

export type StaggerListProps<T> = {
  items: readonly T[];
  keyOf: (t: T) => string;
  armed: boolean;
  /** Rows already visible before the change (never animate). */
  initialCount?: number;
  renderItem: (t: T, i: number, enterStyle: ViewStyle | null) => React.ReactNode;
  cap?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** The host's Set of shown keys, when the list can remount while the host stays. */
  seenStore?: React.MutableRefObject<Set<string> | null>;
};

function StaggerRow<T>({ item, index, newIndex, armed, cap, render }: {
  item: T; index: number; newIndex: number | null; armed: boolean; cap: number;
  render: (t: T, i: number, s: ViewStyle | null) => React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const plan = planStaggerList(reduce, (newIndex ?? 0) + 1, cap);
  const s = newIndex == null ? null : plan.steps[newIndex];
  const live = armed && !!s && s.durationMs > 0;
  const style = useEntrance(live, s ? { ...entranceOf(s), web: 'rise8' } : { fadeMs: 0 }, { desktopWebOnly: true });
  return <>{render(item, index, style)}</>;
}

export function StaggerList<T>({ items, keyOf, armed, initialCount = 0, renderItem, cap = KIT_STAGGER.cap, style, testID, seenStore }: StaggerListProps<T>) {
  const seen = useSeenKeys(seenStore);
  const mounted = useRef(false);
  // Rows visible before the change: the first `initialCount` at mount.
  if (!mounted.current) {
    seen.mark(items.slice(0, Math.max(0, initialCount)).map(keyOf));
  }
  let fresh = 0;
  const rows = items.map((t, i) => {
    const k = keyOf(t);
    const isNew = !seen.has(k);
    const newIndex = isNew ? fresh++ : null;
    return <StaggerRow key={k} item={t} index={i} newIndex={newIndex} armed={armed && isNew} cap={cap} render={renderItem} />;
  });
  // After the commit, everything shown is "seen" (cached rows at mount included).
  useEffect(() => {
    mounted.current = true;
    seen.mark(items.map(keyOf));
  });
  return <View testID={testID} style={style}>{rows}</View>;
}

export default StaggerList;
