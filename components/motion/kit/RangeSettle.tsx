// RangeSettle — Cost Cards to Range (pattern 5), on the Level motif.
//
// Two prices resolve into one low–high range. The track (a 2 pt rule in the
// host's colour — the Level's track) draws out from its centre over 240 ms;
// the LOW label glides from the centre to the left end on glideLead, the HIGH
// label to the right end on glideTrail (reading order: low lands first). The
// labels never scale and never drop below opacity 1 while they move — both
// endpoints stay legible the whole time. The expected figure IS the Level
// bubble: it starts at the track's centre and settles last, on rise, 120 ms
// after the labels — "settles only when the work is done".
//
// Money is never tweened: every label shows its final figure from frame one.
// high ≤ low → one value, no range motion; labels that would collide stack
// under the track and do not travel; expected is clamped into [low, high].
//
// Reduce Motion: the final layout; track, labels and bubble fade in over 100 ms.
// Web (desktop): keyframe travel on transform, 200 / 300 / 280 ms (webMsFor).

import React, { useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useReducedMotion } from '@/components/ui/motion';
import { KIT_DIST } from '@/utils/motion/kit/kitSpec';
import { entranceOf, planRangeSettle, stepFor, type PlanStep } from '@/utils/motion/kit/plans';
import { rangeLayout } from '@/utils/motion/kit/rangeGeometry';
import { webMsFor } from '@/utils/motion/kit/springMath';
import { kitTravel, kitWebStyle } from './css/kitCss';
import { useEntrance, type EntranceSpec } from './useEntrance';

export type RangeSettleProps = {
  /** Integer cents. */
  low: number;
  high: number;
  expected?: number | null;
  format: (cents: number) => string;
  armed: boolean;
  /** The host's colours for the track and the bubble (the kit holds none). */
  tone?: { track?: string; bubble?: string };
  /** Replace a label's default text (the formatted figure). */
  labels?: { low?: React.ReactNode; high?: React.ReactNode; expected?: React.ReactNode };
  textStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const BUBBLE = 10;
const LANE = 12;

function specFor(s: PlanStep | null, web: EntranceSpec['webStyle'], webMs?: number): EntranceSpec {
  if (!s) return { fadeMs: 0 };
  return { ...entranceOf(s), webStyle: web, webMs };
}

export function RangeSettle({ low, high, expected, format, armed, tone, labels, textStyle, style, testID }: RangeSettleProps) {
  const reduce = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [lw, setLw] = useState(0);
  const [hw, setHw] = useState(0);
  const seen = useRef(false);
  if (armed) seen.current = true;

  const layout = rangeLayout(low, high, expected ?? null, width, { low: lw, high: hw });
  const measured = width > 0 && lw > 0 && (layout.single || hw > 0);
  const go = seen.current && measured;
  const plan = planRangeSettle(reduce, layout);
  const S = (t: string) => stepFor(plan, t);

  const leadMs = webMsFor('glideLead');
  const trailMs = webMsFor('glideTrail');
  const riseMs = webMsFor('rise');
  const opts = { desktopWebOnly: true };
  // Web styles are built only on the web, and only once measured (the travel needs the widths).
  const onWeb = Platform.OS === 'web' && go;
  const bubbleStep = S('bubble');
  const bubbleDelay = bubbleStep?.delayMs ?? 0;
  const track = useEntrance(go && !!S('track'), specFor(S('track'), onWeb ? kitWebStyle('drawC') : null, 240), opts);
  const lowM = useEntrance(go && !!S('low'), specFor(S('low'), onWeb ? kitTravel(layout.lowFromX, 0, leadMs) : null, leadMs), opts);
  const highM = useEntrance(go && !!S('high'), specFor(S('high'), onWeb ? kitTravel(layout.highFromX, 0, trailMs) : null, trailMs), opts);
  const bubble = useEntrance(go && !!bubbleStep, specFor(bubbleStep, onWeb ? kitTravel(layout.bubbleFromX, 0, riseMs, bubbleDelay) : null, bubbleDelay + riseMs), opts);

  const onWidth = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const onLow = (e: LayoutChangeEvent) => setLw(Math.round(e.nativeEvent.layout.width));
  const onHigh = (e: LayoutChangeEvent) => setHw(Math.round(e.nativeEvent.layout.width));

  // Armed before the first measurement: hold the whole range hidden (opacity
  // only) for the frame or two until the travel distances are known.
  const holding = seen.current && !measured;
  const label = (node: React.ReactNode | undefined, cents: number) => node ?? <Text style={textStyle}>{format(cents)}</Text>;

  return (
    <View testID={testID} style={[style, holding ? styles.hold : null]} onLayout={onWidth}>
      <View style={styles.lane}>
        <Animated.View style={[styles.track, tone?.track ? { backgroundColor: tone.track } : null, track]} />
        {layout.expectedX != null && width > 0 ? (
          <Animated.View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.bubble, { left: layout.expectedX - BUBBLE / 2 }, tone?.bubble ? { backgroundColor: tone.bubble } : null, bubble]}
          />
        ) : null}
      </View>
      <View style={layout.single ? styles.single : layout.stacked ? styles.stacked : styles.labels}>
        <Animated.View onLayout={onLow} style={lowM}>{label(labels?.low, low)}</Animated.View>
        {!layout.single ? <Animated.View onLayout={onHigh} style={highM}>{label(labels?.high, high)}</Animated.View> : null}
      </View>
      {labels?.expected && layout.expected != null ? <View style={styles.expected}>{labels.expected}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hold: { opacity: 0 },
  lane: { height: LANE, justifyContent: 'center' },
  track: { height: KIT_DIST.rule, borderRadius: KIT_DIST.rule / 2 },
  bubble: { position: 'absolute', top: (LANE - BUBBLE) / 2, width: BUBBLE, height: BUBBLE, borderRadius: BUBBLE / 2 },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  stacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 2, marginTop: 6 },
  single: { flexDirection: 'row', justifyContent: 'center', marginTop: 6 },
  expected: { marginTop: 4, alignItems: 'center' },
});

export default RangeSettle;
