// PriorityGrid — Grid with Priority Reveal (pattern 7).
//
// The cells enter in reading order on the list's numbers (35 ms apart, cap 8).
// 120 ms after the last animated cell has landed, the PRIORITY cell — chosen by
// the host from real data (chooseNextStep(), worst-first) — gets its emphasis:
// a 2 pt rule in the host's accent draws along its top edge from the left
// (scaleX 0 → 1 over 240 ms) while the cell nudges up 2 pt and settles back on
// rise. The other cells are untouched: no dimming, all fully present.
// The rule is what stays; nothing is left transformed at rest.
//
// A later priority change: the new cell's rule draws (240 ms) while the old
// cell's rule fades out over 120 ms (opacity only) and then unmounts.
//
// Reduce Motion: the cells fade in together; no lift; the rule fades in 100 ms
// (and an old rule fades out in 100 ms; on web it simply goes).

import React from 'react';
import { Animated, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { motionCurve, nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import { KIT_DIST, KIT_SPRING, KIT_STAGGER } from '@/utils/motion/kit/kitSpec';
import { entranceOf, planPriorityGrid, stepFor } from '@/utils/motion/kit/plans';
import { kitFadeOut, kitWebStyle } from './css/kitCss';
import { useEntrance } from './useEntrance';

/** The web nudge's length (lift2). */
const LIFT_WEB_MS = 520;

export type PriorityCell = { key: string; render: () => React.ReactNode };

export type PriorityGridProps = {
  cells: readonly PriorityCell[];
  priorityKey: string | null;
  armed: boolean;
  columns: number;
  /** The rule's colour (the host's accent). */
  ruleColor: string;
  /** Gap between cells (pt). */
  gap?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

function Cell({ cell, index, count, armed, priority, columns, gap, ruleColor, changed, leaving }: {
  cell: PriorityCell; index: number; count: number; armed: boolean; priority: boolean; columns: number; gap: number; ruleColor: string; changed: boolean; leaving: boolean;
}) {
  const reduce = useReducedMotion();
  const plan = planPriorityGrid(reduce, count, KIT_STAGGER.cap);
  const s = stepFor(plan, `cell-${index}`);
  const enter = useEntrance(armed && !!s, s ? { ...entranceOf(s), web: 'rise8' } : { fadeMs: 0 }, { desktopWebOnly: true });
  const width = `${100 / Math.max(1, columns)}%` as const;
  return (
    <View style={{ width, padding: gap / 2 }}>
      <Animated.View style={enter}>
        {priority ? (
          <PriorityMark armed={armed || changed} count={count} ruleColor={ruleColor} fresh={changed}>{cell.render()}</PriorityMark>
        ) : leaving ? (
          <View>{cell.render()}<RuleOut ruleColor={ruleColor} /></View>
        ) : cell.render()}
      </Animated.View>
    </View>
  );
}

function PriorityMark({ armed, count, ruleColor, fresh, children }: { armed: boolean; count: number; ruleColor: string; fresh: boolean; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const plan = planPriorityGrid(reduce, fresh ? 0 : count, KIT_STAGGER.cap);
  const rule = stepFor(plan, 'rule');
  const lifts = plan.steps.filter((x) => x.target === 'lift');
  // A changed priority draws at once; the first one waits for the grid to land.
  const ruleSpec = rule ? { ...entranceOf(rule), delayMs: fresh ? 0 : rule.delayMs, web: 'drawL' as const } : { fadeMs: 0 };
  const ruleMotion = useEntrance(armed && !!rule, ruleSpec, { desktopWebOnly: true });
  const lift = useLiftNudge(armed && lifts.length === 2, fresh ? 0 : lifts[0]?.delayMs ?? 0);
  return (
    <Animated.View style={lift}>
      {children}
      <Animated.View pointerEvents="none" style={[styles.rule, { backgroundColor: ruleColor }, ruleMotion]} />
    </Animated.View>
  );
}

/**
 * The old priority's rule on a change: opacity 1 → 0 over the plan's
 * 'rule-old' step (native driver), then unmounted. Desktop web plays the
 * kit's fade-out class over a resting opacity 0; reduced web just hides it.
 */
function RuleOut({ ruleColor }: { ruleColor: string }) {
  const reduce = useReducedMotion();
  const desktopWeb = useIsDesktopWeb();
  const web = Platform.OS === 'web';
  const ms = stepFor(planPriorityGrid(reduce, 0, KIT_STAGGER.cap), 'rule-old')?.durationMs ?? 0;
  const v = React.useRef<Animated.Value | null>(null);
  if (!v.current && !web && ms > 0) v.current = new Animated.Value(1);
  const [done, setDone] = React.useState(!web && ms === 0);
  React.useLayoutEffect(() => {
    const a = v.current;
    if (!a) return;
    const t = Animated.timing(a, { toValue: 0, duration: ms, easing: motionCurve.in, useNativeDriver: nativeDriver });
    t.start(({ finished }) => { if (finished) setDone(true); });
    return () => t.stop();
  }, [ms]);
  if (done) return null;
  const motion = web
    ? [{ opacity: 0 }, desktopWeb && !reduce ? kitFadeOut(ms) : null]
    : [{ opacity: v.current ?? 0 } as unknown as ViewStyle];
  return <Animated.View pointerEvents="none" style={[styles.rule, { backgroundColor: ruleColor }, ...motion]} />;
}

/**
 * The 2 pt nudge: up on rise, then back on rise (native), or the lift2
 * keyframe (desktop web). Null before, and null from the first render after it
 * ends — nothing stays transformed.
 */
function useLiftNudge(armed: boolean, delayMs: number): ViewStyle | null {
  const desktopWeb = useIsDesktopWeb();
  const web = Platform.OS === 'web';
  const run = React.useRef<{ v: Animated.Value | null; style: ViewStyle | null; at: number; done: boolean } | null>(null);
  if (armed && !run.current) {
    if (web) {
      run.current = { v: null, style: desktopWeb ? kitWebStyle('lift2', delayMs) : null, at: Date.now(), done: !desktopWeb };
    } else {
      const v = new Animated.Value(0);
      run.current = { v, style: { transform: [{ translateY: v }] } as unknown as ViewStyle, at: Date.now(), done: false };
    }
  }
  React.useLayoutEffect(() => {
    const r = run.current;
    if (!r || !r.v || r.done) return;
    const a = Animated.sequence([
      Animated.delay(delayMs),
      Animated.spring(r.v, { toValue: -KIT_DIST.focusLift, ...KIT_SPRING.rise, useNativeDriver: nativeDriver }),
      Animated.spring(r.v, { toValue: 0, ...KIT_SPRING.rise, useNativeDriver: nativeDriver }),
    ]);
    a.start(() => { r.done = true; });
    return () => a.stop();
    // Once per arm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.current]);
  const r = run.current;
  if (!r || r.done) return null;
  if (web && Date.now() - r.at >= delayMs + LIFT_WEB_MS) return null;
  return r.style;
}

export function PriorityGrid({ cells, priorityKey, armed, columns, ruleColor, gap = 8, style, testID }: PriorityGridProps) {
  const prev = React.useRef(priorityKey);
  const changedTo = React.useRef<string | null>(null);
  const changedFrom = React.useRef<string | null>(null);
  if (prev.current !== priorityKey) {
    changedFrom.current = prev.current;
    changedTo.current = priorityKey;
    prev.current = priorityKey;
  }
  return (
    <View testID={testID} style={[styles.grid, { margin: -gap / 2 }, style]}>
      {cells.map((c, i) => (
        <Cell
          key={c.key}
          cell={c}
          index={i}
          count={cells.length}
          armed={armed}
          priority={c.key === priorityKey}
          columns={columns}
          gap={gap}
          ruleColor={ruleColor}
          changed={changedTo.current === c.key}
          leaving={changedFrom.current === c.key && c.key !== priorityKey}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  rule: { position: 'absolute', left: 0, right: 0, top: 0, height: KIT_DIST.rule, transformOrigin: 'left' },
});

export default PriorityGrid;
