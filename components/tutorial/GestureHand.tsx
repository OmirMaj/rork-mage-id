// components/tutorial/GestureHand.tsx — the animated hand from the reference
// video: it shows WHERE, the card says WHAT.
//
// lucide Pointer on touch, MousePointerClick with a fine pointer (web mouse),
// 44 pt on a small surface disc. The fingertip sits on `point` (placement.
// handPoint: the hole centre + (8, 10), or a normalized point inside the
// target for 'tap-point' — the Kitchen label on the sample plan).
//
//   'tap'        scale 1 → 0.86 → 1 plus a ripple ring, looping every 1.6 s.
//   'tap-point'  travels from `from` (the card) to the point over 700 ms,
//                then taps.
//
// Appears 700 ms after the spotlight settles. Native driver throughout (only
// transform and opacity animate). Reduce Motion: a static hand, no loop.
// Hidden from accessibility — the card carries the instruction.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { MousePointerClick, Pointer } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { Tokens } from '@/constants/designTokens';

const DISC = 44;
/** The fingertip's offset inside the disc (the icon's tip, top-left-ish). */
const TIP = { x: 15, y: 9 };
const LOOP_MS = 1600;
const TRAVEL_MS = 700;
const APPEAR_DELAY_MS = 700;

export interface GestureHandProps {
  point: { x: number; y: number };
  /** Where a 'tap-point' travel starts (layer coords). */
  from?: { x: number; y: number } | null;
  gesture: 'tap' | 'tap-point';
  pointerFine: boolean;
  reduceMotion: boolean;
  /** Bump to replay from the start (a tap on the dim). */
  replayKey: number;
}

export function GestureHand({ point, from, gesture, pointerFine, reduceMotion, replayKey }: GestureHandProps) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;
  const ripple = useRef(new Animated.Value(0)).current;
  const travel = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const left = point.x - TIP.x;
  const top = point.y - TIP.y;

  useEffect(() => {
    opacity.setValue(0);
    press.setValue(1);
    ripple.setValue(0);
    const startOffset =
      gesture === 'tap-point' && from && !reduceMotion ? { x: from.x - point.x, y: from.y - point.y } : { x: 0, y: 0 };
    travel.setValue(startOffset);

    if (reduceMotion) {
      // Static: no travel, no loop — just the hand, where it belongs.
      opacity.setValue(1);
      return;
    }

    const tapLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.sequence([
            Animated.timing(press, { toValue: 0.86, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(press, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(ripple, { toValue: 0, duration: 0, useNativeDriver: true }),
            Animated.timing(ripple, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          ]),
        ]),
        Animated.delay(LOOP_MS - 700),
      ]),
    );

    const intro = Animated.sequence([
      Animated.delay(APPEAR_DELAY_MS),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ...(startOffset.x !== 0 || startOffset.y !== 0
        ? [Animated.timing(travel, { toValue: { x: 0, y: 0 }, duration: TRAVEL_MS, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true })]
        : []),
    ]);
    let loop: Animated.CompositeAnimation | null = null;
    intro.start(({ finished }) => {
      if (!finished) return;
      loop = tapLoop;
      loop.start();
    });
    return () => {
      intro.stop();
      loop?.stop();
    };
    // The point moves on every re-measure; restarting the whole intro on a
    // 1 px drift would make the hand flicker, so only the gesture, the start
    // and an explicit replay restart it. Position changes just move `left/top`.
  }, [gesture, reduceMotion, replayKey, from?.x, from?.y]); // eslint-disable-line react-hooks/exhaustive-deps

  const Icon = pointerFine ? MousePointerClick : Pointer;
  const rippleScale = ripple.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] });
  const rippleOpacity = ripple.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 0.5, 0] });

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.anchor, { left, top }]}
    >
      <Animated.View
        style={[
          styles.ripple,
          { borderColor: colors.accentFill, opacity: reduceMotion ? 0 : rippleOpacity, transform: [{ scale: rippleScale }] },
        ]}
      />
      <Animated.View
        style={[
          styles.disc,
          Tokens.shadow.medium,
          {
            backgroundColor: colors.surface,
            opacity,
            transform: [{ translateX: travel.x }, { translateY: travel.y }, { scale: press }],
          },
        ]}
      >
        <Icon size={24} strokeWidth={2} color={colors.text} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', width: DISC, height: DISC },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ripple: {
    position: 'absolute',
    // Centred on the fingertip, not the disc.
    left: TIP.x - 16,
    top: TIP.y - 16,
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.full,
    borderWidth: 2,
  },
});

export default GestureHand;
