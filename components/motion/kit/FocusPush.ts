// FocusPush — Roadmap Focus Push (pattern 9), the app's form.
//
// In the app the "camera push" NEVER scales a surface (a full-screen layer at
// 2× is how a 4K monitor drops frames). It is three honest things instead:
// the host's own native scroll to the focused item (scrollTo animated), the
// item's accent rule drawing itself (scaleX 0 → 1 over 240 ms) once the scroll
// has settled — onScrollSettled() from onMomentumScrollEnd, or 320 ms at most,
// baked into the timing as a plateau — and the heading swapping through the
// host's useSwapFade (components/ui/motion.ts).
//
//   const push = useFocusPush(scrollRef);
//   push('critical-path', rect);            // scroll + arm the rule
//   <Animated.View style={[styles.rule, push.styleFor('critical-path')]} />
//   <ScrollView onMomentumScrollEnd={push.onScrollSettled} … />
//
// Reduce Motion: the scroll jumps (animated: false) and the rule is simply
// there. Web (desktop): the drawL keyframe after the same 320 ms.
//
// A vertical rule (lane KITFIX, KG3): `axis` is the SCROLL axis (default 'y',
// shipped); the rule's own axis is `ruleAxis` — 'x' (default, shipped: scaleX
// from the left, drawL) or 'y' (scaleY growing down from the top, drawT), for a
// vertical line such as the Gantt's Today marker:
//   useFocusPush(hScrollRef, { axis: 'x', ruleAxis: 'y' })

import { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, Platform, type ViewStyle } from 'react-native';
import { motionCurve, nativeDriver, useReducedMotion } from '@/components/ui/motion';
import type { KitRect } from '@/utils/motion/kit/focusGlide';
import { planFocusPush, ruleDraw, stepFor, type RuleAxis } from '@/utils/motion/kit/plans';
import { plateauEase, plateauFraction } from '@/utils/motion/kit/stagger';
import { kitWebStyle } from './css/kitCss';

export type Scrollable = { scrollTo: (o: { x?: number; y?: number; animated?: boolean }) => void };

export type FocusPush = ((key: string, rect: KitRect) => ViewStyle | null) & {
  /** The rule style for an item (null unless it is the pushed item and its rule is drawing). */
  styleFor: (key: string) => ViewStyle | null;
  /** Call from onMomentumScrollEnd: the rule starts drawing now instead of at 320 ms. */
  onScrollSettled: () => void;
  activeKey: string | null;
};

export type FocusPushOptions = {
  /** The scroll axis (default 'y'). */
  axis?: 'x' | 'y';
  /** How far before the item the scroll stops (default 16). */
  inset?: number;
  /** The rule's own axis: 'x' draws horizontally from the left (default), 'y' vertically from the top. */
  ruleAxis?: RuleAxis;
};

export function useFocusPush(scrollRef: { current: Scrollable | null }, opts: FocusPushOptions = {}): FocusPush {
  const reduce = useReducedMotion();
  const web = Platform.OS === 'web';
  const [active, setActive] = useState<{ key: string; at: number } | null>(null);
  const v = useRef(new Animated.Value(1)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const waiting = useRef(false);
  const done = useRef(true);
  const axis = opts.axis ?? 'y';
  const inset = opts.inset ?? 16;
  const ruleAxis: RuleAxis = opts.ruleAxis === 'y' ? 'y' : 'x';
  const draw = ruleDraw(ruleAxis);

  const plan = planFocusPush(reduce, ruleAxis);
  const rule = stepFor(plan, 'rule');
  const waitMs = rule?.delayMs ?? 0;
  const drawMs = rule?.durationMs ?? 0;

  const push = useCallback((key: string, rect: KitRect) => {
    const to = Math.max(0, (axis === 'y' ? rect.y : rect.x) - inset);
    scrollRef.current?.scrollTo(axis === 'y' ? { y: to, animated: !reduce } : { x: to, animated: !reduce });
    anim.current?.stop();
    if (reduce || drawMs === 0) {
      done.current = true;
      setActive({ key, at: Date.now() });
      return null;
    }
    done.current = false;
    waiting.current = true;
    setActive({ key, at: Date.now() });
    if (web) return null;
    v.setValue(0);
    const a = Animated.timing(v, {
      toValue: 1,
      duration: waitMs + drawMs,
      easing: plateauEase(plateauFraction(waitMs, drawMs), motionCurve.out),
      useNativeDriver: nativeDriver,
    });
    anim.current = a;
    a.start(({ finished }) => { if (finished) { waiting.current = false; done.current = true; } });
    return null;
  }, [axis, inset, reduce, drawMs, waitMs, web, scrollRef, v]);

  const onScrollSettled = useCallback(() => {
    if (!waiting.current || web || reduce) return;
    waiting.current = false;
    anim.current?.stop();
    const a = Animated.timing(v, { toValue: 1, duration: drawMs, easing: motionCurve.out, useNativeDriver: nativeDriver });
    anim.current = a;
    a.start(({ finished }) => { if (finished) done.current = true; });
  }, [drawMs, reduce, v, web]);

  const nativeRule = useMemo(
    () => ({ transform: [draw.scaleKey === 'scaleY' ? { scaleY: v } : { scaleX: v }], transformOrigin: draw.origin } as unknown as ViewStyle),
    [v, draw.scaleKey, draw.origin],
  );

  const styleFor = useCallback((key: string): ViewStyle | null => {
    if (!active || active.key !== key || reduce) return null;
    if (web) {
      if (Date.now() - active.at >= waitMs + drawMs) return null;
      return kitWebStyle(draw.web, waitMs);
    }
    return done.current ? null : nativeRule;
  }, [active, reduce, web, waitMs, drawMs, nativeRule, draw.web]);

  return useMemo(() => Object.assign((key: string, rect: KitRect) => {
    push(key, rect);
    return styleFor(key);
  }, { styleFor, onScrollSettled, activeKey: active?.key ?? null }), [push, styleFor, onScrollSettled, active]);
}

export default useFocusPush;
