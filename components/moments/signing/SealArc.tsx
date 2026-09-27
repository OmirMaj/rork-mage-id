// SealArc — one half of the seal's two-arc ring, drawn natively.
//
// THE HALF-RING TRICK (uniform ring, no per-side border colours). A fixed clip
// exactly one half of the seal (64 x 32, overflow hidden) holds a ROTOR the size
// of the whole seal, centred on the seal. The rotor holds an inner clip over its
// LEFT half, and in it a full ring with ONE border colour: so the rotor carries
// a semicircle (6 -> 9 -> 12 in rotor space). Rotating the rotor clockwise by
// 180deg sweeps that semicircle into the fixed clip:
//   TOP arc (contractor): rotor -90deg -> 90deg; the semicircle starts on the
//     bottom half (hidden) and grows from 9 o'clock through 12 to 3.
//   BOTTOM arc (homeowner): rotor 90deg -> 270deg; it grows from 3 through 6
//     to 9 and closes the ring.
// Why not a ring with two coloured and two transparent sides: WebKit paints a
// border with mixed side colours in per-side wedges that meet at the centre,
// and an RN-web render showed that seam as a hairline from 9 o'clock to the
// centre whenever the ring sat near an axis-aligned angle. A single-colour
// border has no side wedges, and the two clips only ever cut the ring itself.
// Only `rotate` and the clip's opacity animate (native driver). A pre-drawn
// arc mounts at progress 1.

import React from 'react';
import { Animated, StyleSheet } from 'react-native';

export interface SealArcProps {
  half: 'top' | 'bottom';
  /** 0 = hidden, 1 = drawn. */
  progress: Animated.Value;
  color: string;
  /** The seal box (64). */
  size?: number;
  /** Ring radius to the stroke centre (30.6). */
  r?: number;
  stroke?: number;
  testID?: string;
}

export function SealArc({ half, progress, color, size = 64, r = 30.6, stroke = 1.5, testID }: SealArcProps) {
  const d = 2 * r + stroke;
  const off = (size - d) / 2;
  const top = half === 'top';
  const rotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: top ? ['-90deg', '90deg'] : ['90deg', '270deg'],
  });
  // An undrawn arc paints nothing: its ends lie exactly on the clip edge, where
  // an RN-web render showed 1 px slivers at 3 and 9 o'clock. Native opacity.
  const shown = progress.interpolate({ inputRange: [0, 0.01, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' });
  return (
    <Animated.View
      style={[s.clip, { width: size, height: size / 2, top: top ? 0 : size / 2, opacity: shown }]}
      pointerEvents="none"
      testID={testID}
    >
      <Animated.View style={[s.abs, { width: size, height: size, left: 0, top: top ? 0 : -size / 2, transform: [{ rotate }] }]}>
        <Animated.View style={[s.clipInner, { width: size / 2, height: size }]}>
          <Animated.View
            style={[
              s.abs,
              { width: d, height: d, borderRadius: d / 2, borderWidth: stroke, borderColor: color, left: off, top: off },
            ]}
          />
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  clip: { position: 'absolute', left: 0, overflow: 'hidden' },
  abs: { position: 'absolute' },
  clipInner: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
});

export default SealArc;
