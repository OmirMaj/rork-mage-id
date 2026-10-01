// LevelDatum — the DATUM the wide-canvas Level sits on (lane LOADERDESK).
//
// On a site a level establishes a datum: one true horizontal everything else is
// set from. On a laptop or monitor the loaders draw exactly that: a hairline
// running out of the level toward both screen edges, ending in a small tick
// like a dimension line. Nothing else is added.
//
// One segment: a box DESK_DATUM.tickH (9) tall holding a 1 px line on its
// centre (top 4) and a 1 × 9 tick at its OUTER end. Theme-free: the host passes
// the colour (the splash's launch ink, or the theme's textMuted) and a static
// View opacity (never an alpha suffix).
//
// Motion (optional): `drive` is the host's OWN amp value — no new value, no
// timing, no timer here. It scales the segment on X from its INNER end
// (transformOrigin 'right center' for the left segment, 'left center' for the
// right), so the datum draws OUTWARD from the level, symmetric, and can never
// read as a left-to-right progress bar. Transform and opacity only.

import React from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { DESK_DATUM } from '@/utils/levelDesk';

export interface DatumSegmentProps {
  /** Which side of the level: the tick sits at this side's OUTER end. */
  side: 'left' | 'right';
  /** Line + tick colour (a token or a launch constant, passed by the host). */
  color: string;
  /** Static View opacity for the line and the tick. */
  opacity: number;
  /** The host's amp (0 → 1): scaleX from the inner end. Absent = always full. */
  drive?: Animated.Value;
  /** The host's box for the segment (absolute rect, or a flex slot). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function DatumSegment({ side, color, opacity, drive, style, testID }: DatumSegmentProps) {
  const left = side === 'left';
  return (
    <Animated.View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.box,
        left ? styles.originLeft : styles.originRight,
        { opacity },
        drive ? { transform: [{ scaleX: drive }] } : null,
        style,
      ]}
    >
      <View style={[styles.line, { backgroundColor: color }]} />
      <View style={[styles.tick, left ? styles.tickLeft : styles.tickRight, { backgroundColor: color }]} />
    </Animated.View>
  );
}

const D = DESK_DATUM;
const styles = StyleSheet.create({
  box: { height: D.tickH, pointerEvents: 'none' },
  // The INNER end is the pivot: the left segment grows leftward from the level.
  originLeft: { transformOrigin: 'right center' },
  originRight: { transformOrigin: 'left center' },
  line: { position: 'absolute', top: (D.tickH - D.lineH) / 2, left: 0, right: 0, height: D.lineH },
  tick: { position: 'absolute', top: 0, width: D.tickW, height: D.tickH },
  tickLeft: { left: 0 },
  tickRight: { right: 0 },
});
