// CheckSync — Synchronized Action Checklist (pattern 2).
//
// A row ticks ONLY when the host flips its status to 'done' — a queue ack, a
// server answer, a finished phase. Never a timer (components/ThinkingStates.tsx
// advancing fake steps every 1800 ms is the anti-example this replaces).
//
// On 'done': the check glyph lands (opacity 0→1 + scale 0.6→1 on
// Motion.spring.snap) and the host's done tint fades in behind the row over
// 160 ms. Several completions in one burst tick at least 120 ms apart, four
// beats at most (a fifth ticks with the fourth): 3·120 + 180 = 540 ms. With
// `marker`, the active row's 2 pt leading rule (the Level's rule) glides to the
// next active row 60 ms after the check starts (FocusMarker).
// A row that is already done at mount, or 'failed', never animates; 'failed'
// shows whatever the host's renderCheck / render give it (never the check).
//
// Reduce Motion: the check fades in over 100 ms, the rule jumps, no gaps.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from '@/components/ui/motion';
import { queueBeat, type BeatQueue, type CheckStatus } from '@/utils/motion/kit/checkQueue';
import { KIT_DIST } from '@/utils/motion/kit/kitSpec';
import { entranceOf, planCheckSync, stepFor } from '@/utils/motion/kit/plans';
import { FocusMarker, useFocusRects } from './FocusMarker';
import { useEntrance } from './useEntrance';

export type { CheckStatus };

export type CheckRow = {
  key: string;
  status: CheckStatus;
  /** The row's own content (the host's words, its failure line). */
  render: (status: CheckStatus) => React.ReactNode;
};

export type CheckSyncProps = {
  rows: readonly CheckRow[];
  /** The glyph for a state (the host draws the check for 'done'). */
  renderCheck: (status: CheckStatus) => React.ReactNode;
  /** Painted behind a done row (absolute fill), fading in with the tick. */
  doneTint?: React.ReactNode;
  /** Show the active row's leading rule, gliding between rows. */
  marker?: boolean;
  /** The rule's look (the host's accent colour). */
  markerStyle?: StyleProp<ViewStyle>;
  rowStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * The spec's contract (A3): the check glyph's style for a row — null at rest,
 * live only on a real flip to 'done'. `delayMs` is the row's beat (queueBeat).
 */
export function useCheckBeat(status: CheckStatus, delayMs = 0, armed = true): ViewStyle | null {
  return useCheckBeats(status, delayMs, armed).check;
}

/** One row's tick: the glyph and the tint arrive together at the row's beat. */
export function useCheckBeats(status: CheckStatus, delayMs = 0, armed = true): { check: ViewStyle | null; tint: ViewStyle | null } {
  const reduce = useReducedMotion();
  const plan = planCheckSync(reduce, 1);
  const c = stepFor(plan, 'check-0');
  const t = stepFor(plan, 'tint-0');
  const live = armed && status === 'done';
  const check = useEntrance(live, c ? { ...entranceOf(c), delayMs: reduce ? 0 : delayMs, web: 'check60' } : { fadeMs: 0 });
  const tint = useEntrance(live, t ? { ...entranceOf(t), delayMs: reduce ? 0 : delayMs, web: 'fade' } : { fadeMs: 0 });
  return { check, tint };
}

function CheckCell({ status, delayMs, armed, renderCheck, doneTint }: {
  status: CheckStatus; delayMs: number; armed: boolean;
  renderCheck: CheckSyncProps['renderCheck']; doneTint?: React.ReactNode;
}) {
  const beat = useCheckBeats(status, delayMs, armed);
  return (
    <>
      {doneTint && status === 'done' ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, beat.tint]}>{doneTint}</Animated.View>
      ) : null}
      <Animated.View style={beat.check}>{renderCheck(status)}</Animated.View>
    </>
  );
}

export function CheckSync({ rows, renderCheck, doneTint, marker = false, markerStyle, rowStyle, style, testID }: CheckSyncProps) {
  const reduce = useReducedMotion();
  const focus = useFocusRects();
  const [flying, setFlying] = useState(false);
  const prev = useRef<Record<string, CheckStatus> | null>(null);
  const queue = useRef<BeatQueue>({ burstAt: 0, count: 0 });
  // key → the beat its latest real completion ticks on (set the render it turned done).
  const beats = useRef<Record<string, { delayMs: number; gen: number; from: object }>>({});

  const seenBefore = prev.current;
  if (seenBefore) {
    const now = Date.now();
    for (const r of rows) {
      const was = seenBefore[r.key];
      // Once per transition: a second render before the commit (StrictMode)
      // sees the same `prev` snapshot and leaves the queue alone.
      if (r.status === 'done' && was !== undefined && was !== 'done' && beats.current[r.key]?.from !== seenBefore) {
        const q = queueBeat(queue.current, now, reduce);
        queue.current = q.queue;
        beats.current[r.key] = { delayMs: q.delayMs, gen: (beats.current[r.key]?.gen ?? 0) + 1, from: seenBefore };
      }
    }
  }
  useEffect(() => {
    prev.current = Object.fromEntries(rows.map((r) => [r.key, r.status]));
  });

  const activeKey = rows.find((r) => r.status === 'active')?.key ?? null;
  const plan = planCheckSync(reduce, 1);
  const markerDelay = stepFor(plan, 'marker')?.delayMs ?? 0;

  return (
    <View testID={testID} style={style}>
      {rows.map((r) => {
        const b = beats.current[r.key];
        const live = !!b && r.status === 'done';
        return (
          <View key={r.key} style={[styles.row, rowStyle]} onLayout={focus.onLayoutFor(r.key)}>
            <CheckCell
              key={`${r.status}|${b?.gen ?? 0}`}
              status={r.status}
              delayMs={b?.delayMs ?? 0}
              armed={live}
              renderCheck={renderCheck}
              doneTint={doneTint}
            />
            {marker && r.status === 'active' && !flying ? <View pointerEvents="none" style={[styles.rule, markerStyle]} /> : null}
            {r.render(r.status)}
          </View>
        );
      })}
      {marker ? (
        <FocusMarker axis="y" activeKey={activeKey} rects={focus.rects} delayMs={markerDelay} onFlight={setFlying} style={[styles.markerBox, markerStyle]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  rule: { position: 'absolute', left: 0, top: 0, bottom: 0, width: KIT_DIST.rule },
  markerBox: { left: 0, width: KIT_DIST.rule },
});

export default CheckSync;
