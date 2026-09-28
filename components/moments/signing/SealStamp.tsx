// SealStamp — the seal the busy circle lifts into when a signature is
// CONFIRMED stored. 64 x 64, positioned on the card by translate from its
// centre (translateX/Y = x - 32, y - 32) and scaled by s.
//
//  - shadow: a 44 pt disc in sealFace with iOS shadow props, inside a wrapper
//    whose opacity is `sh`. No blur filter.
//  - ring (opacity ringO, scale ringS): an Svg drawn ONCE — the sealFace circle
//    and the static ring text on a circular TextPath (unique path id per
//    instance) — plus the two SealArc halves over it (contractor top,
//    homeowner bottom). Only the wrappers' opacity / transform animate.
//  - disc (scale d): the capsule's brand fill, the success layer (tS), the busy
//    ring (continuing the capsule's spin), the two-leg check and the "1 of 2"
//    count.
//
// LEGAL: the ring text is built by the caller from the STORED record
// (utils/moments/sealText.ts buildSealRingText); nothing here invents a date,
// and this component is only mounted with values the ceremony's playConfirmed
// drives (it renders at opacity 0 until then).

import React, { useId, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Path, Text as SvgText, TextPath } from 'react-native-svg';
import { Type } from '@/constants/typography';
import { BusyRing, TwoLegCheck } from '@/components/moments/core/contract';
import type { MomentColors } from '@/utils/moments/colors';
import { SealArc } from '@/components/moments/signing/SealArc';

export interface SealValues {
  x: Animated.Value;
  y: Animated.Value;
  s: Animated.Value;
  d: Animated.Value;
  o: Animated.Value;
  ringO: Animated.Value;
  ringS: Animated.Value;
  tS: Animated.Value;
  busy: Animated.Value;
  checkShort: Animated.Value;
  checkLong: Animated.Value;
  cnt: Animated.Value;
  sh: Animated.Value;
  arcTop: Animated.Value;
  arcBottom: Animated.Value;
}

export function useSealValues(): SealValues {
  const ref = useRef<SealValues | null>(null);
  if (!ref.current) {
    const v = (n: number) => new Animated.Value(n);
    ref.current = {
      x: v(0), y: v(0), s: v(1), d: v(1), o: v(0), ringO: v(0), ringS: v(0.86), tS: v(0), busy: v(0),
      checkShort: v(0), checkLong: v(0), cnt: v(0), sh: v(0), arcTop: v(0), arcBottom: v(0),
    };
  }
  return ref.current;
}

/** The SVG ring-text circle: radius 24.2 about (32, 32), starting at 9 o'clock. */
export const SEAL_TEXT_PATH = 'M32,32 m-24.2,0 a24.2,24.2 0 1,1 48.4,0 a24.2,24.2 0 1,1 -48.4,0';

export interface SealStampProps {
  values: SealValues;
  /** The capsule's spin value, so the busy ring keeps turning through the hand-off. */
  spin: Animated.Value;
  ringText: string;
  countText?: string;
  colors: MomentColors;
  testID?: string;
}

export function SealStamp({ values: v, spin, ringText, countText, colors: mc, testID }: SealStampProps) {
  const rawId = useId();
  const pathId = `sealring${rawId.replace(/[^A-Za-z0-9]/g, '')}`;
  const tx = useRef(Animated.add(v.x, -32)).current;
  const ty = useRef(Animated.add(v.y, -32)).current;

  return (
    <Animated.View
      style={[s.seal, { opacity: v.o, transform: [{ translateX: tx }, { translateY: ty }, { scale: v.s }] }]}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      testID={testID}
    >
      <Animated.View style={[s.shadowWrap, { opacity: v.sh }]}>
        <View style={[s.shadow, { backgroundColor: mc.sealFace, shadowColor: mc.ink }]} />
      </Animated.View>
      <Animated.View style={[s.fill, { opacity: v.ringO, transform: [{ scale: v.ringS }] }]}>
        <Svg width={64} height={64} viewBox="0 0 64 64">
          <Defs>
            <Path id={pathId} d={SEAL_TEXT_PATH} />
          </Defs>
          <Circle cx={32} cy={32} r={30.6} fill={mc.sealFace} />
          <SvgText fontSize={6.1} fontWeight="600" letterSpacing={0.9} fill={mc.seal}>
            <TextPath href={`#${pathId}`} textLength={150} lengthAdjust="spacing">
              {ringText}
            </TextPath>
          </SvgText>
        </Svg>
        <SealArc half="top" progress={v.arcTop} color={mc.seal} testID={testID ? `${testID}-arc-top` : undefined} />
        <SealArc half="bottom" progress={v.arcBottom} color={mc.seal} testID={testID ? `${testID}-arc-bottom` : undefined} />
      </Animated.View>
      <Animated.View style={[s.disc, { transform: [{ scale: v.d }] }]}>
        <View style={[s.fill, { backgroundColor: mc.capFill.brand }]} />
        <Animated.View style={[s.fill, { backgroundColor: mc.success, opacity: v.tS }]} />
        <BusyRing opacity={v.busy} spin={spin} size={40} inset={7} color={mc.onSuccess} />
        <View style={s.centre} pointerEvents="none">
          <TwoLegCheck short={v.checkShort} long={v.checkLong} width={15} height={7.5} color={mc.onSuccess} />
        </View>
        {countText ? (
          <Animated.View style={[s.centre, { opacity: v.cnt }]} pointerEvents="none">
            <Text style={[s.count, { color: mc.onSuccess }]} numberOfLines={1}>
              {countText}
            </Text>
          </Animated.View>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  seal: { position: 'absolute', left: 0, top: 0, width: 64, height: 64, zIndex: 20 },
  fill: { ...StyleSheet.absoluteFillObject },
  shadowWrap: { ...StyleSheet.absoluteFillObject },
  shadow: {
    position: 'absolute',
    left: 10,
    top: 14,
    width: 44,
    height: 44,
    borderRadius: 22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
  },
  disc: { position: 'absolute', left: 12, top: 12, width: 40, height: 40, borderRadius: 20, overflow: 'hidden' },
  centre: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  count: { ...Type.caption1, fontWeight: '700' },
});

export default SealStamp;
