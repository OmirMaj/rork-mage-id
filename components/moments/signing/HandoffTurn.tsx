// HandoffTurn — the in-person hand-off: the card turns to face the other
// person (rotateY), and turns back to the contractor's record afterwards.
// It is the only turn in the system, and it means the phone changed hands.
//
// Two faces share one cell. Each face rotates on its own (front 0 -> 180,
// back 180 -> 360) with backfaceVisibility 'hidden' — rotating each face,
// rather than a shared parent, is what hides the far side on iOS, where a
// rotated parent's children are flattened into its plane.
//
// 560 ms on the FOLD curve, native driver, transform only. Android and Reduce
// Motion get the cross-fade (opacity -> 0 over 100, set the angle, -> 1 over
// 100) and NO rotateY at all: 3D is off on Android until a mid-range device
// test passes (utils/moments/platform3d.ts).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { nativeDriver, reducedMotion, useReducedMotion } from '@/components/ui/motion';
import { can3DFor } from '@/utils/moments/platform3d';
import { SIGN_EASE, TURN_TIMING } from '@/utils/moments/signTimeline';
import { momentHaptic, announce } from '@/utils/moments/haptics';

export type TurnSide = 'front' | 'back';

export interface HandoffTurnControl {
  side: TurnSide;
  angle: Animated.Value;
  opacity: Animated.Value;
  /** Turn to a side; resolves when the turn lands. `say` is announced. */
  turn: (to: TurnSide, say?: string) => Promise<void>;
}

const FOLD_EASE = Easing.bezier(SIGN_EASE.fold[0], SIGN_EASE.fold[1], SIGN_EASE.fold[2], SIGN_EASE.fold[3]);

/** Sequencing runs on timers of the animation's own duration, never on a
 *  completion callback (a native completion can be dropped). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useHandoffTurn(initial: TurnSide = 'front'): HandoffTurnControl {
  const angle = useRef(new Animated.Value(initial === 'back' ? 180 : 0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const [side, setSide] = useState<TurnSide>(initial);
  const sideRef = useRef<TurnSide>(initial);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const turn = useCallback(
    async (to: TurnSide, say?: string) => {
      if (sideRef.current === to) return;
      sideRef.current = to;
      momentHaptic('selection');
      const threeD = can3DFor(Platform.OS) && !reducedMotion();
      if (!threeD) {
        // Cross-fade: never a rotateY.
        Animated.timing(opacity, { toValue: 0, duration: TURN_TIMING.xfOut, useNativeDriver: nativeDriver }).start();
        await sleep(TURN_TIMING.xfOut);
        if (!mounted.current) return;
        angle.setValue(to === 'back' ? 180 : 0);
        setSide(to);
        Animated.timing(opacity, { toValue: 1, duration: TURN_TIMING.xfIn, useNativeDriver: nativeDriver }).start();
        await sleep(TURN_TIMING.xfIn);
      } else {
        setSide(to);
        // Hand-off 0 -> 180; hand-back 180 -> 360, then set 0 (same picture).
        Animated.timing(angle, {
          toValue: to === 'back' ? 180 : 360,
          duration: TURN_TIMING.turn,
          easing: FOLD_EASE,
          useNativeDriver: nativeDriver,
        }).start();
        await sleep(TURN_TIMING.turn);
        if (!mounted.current) return;
        if (to === 'front') angle.setValue(0);
      }
      if (say && mounted.current) announce(say);
    },
    [angle, opacity],
  );

  return { side, angle, opacity, turn };
}

export interface HandoffTurnProps {
  control: HandoffTurnControl;
  front: React.ReactNode;
  back: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function HandoffTurn({ control, front, back, style, testID }: HandoffTurnProps) {
  const reduced = useReducedMotion();
  const threeD = can3DFor(Platform.OS) && !reduced;
  const { angle, opacity, side } = control;

  const frontRot = angle.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });
  const backRot = angle.interpolate({ inputRange: [0, 360], outputRange: ['180deg', '540deg'] });

  if (!threeD) {
    // Cross-fade fallback: one face at a time, no rotateY in any transform.
    return (
      <Animated.View style={[style, { opacity }]} testID={testID}>
        <View
          style={side === 'front' ? null : s.hidden}
          importantForAccessibility={side === 'front' ? 'auto' : 'no-hide-descendants'}
          accessibilityElementsHidden={side !== 'front'}
          pointerEvents={side === 'front' ? 'auto' : 'none'}
        >
          {front}
        </View>
        <View
          style={[StyleSheet.absoluteFill, side === 'back' ? null : s.hidden]}
          importantForAccessibility={side === 'back' ? 'auto' : 'no-hide-descendants'}
          accessibilityElementsHidden={side !== 'back'}
          pointerEvents={side === 'back' ? 'auto' : 'none'}
        >
          {back}
        </View>
      </Animated.View>
    );
  }

  return (
    <View style={style} testID={testID}>
      <Animated.View
        style={[s.face, { transform: [{ perspective: TURN_TIMING.perspective }, { rotateY: frontRot }] }]}
        importantForAccessibility={side === 'front' ? 'auto' : 'no-hide-descendants'}
        accessibilityElementsHidden={side !== 'front'}
        pointerEvents={side === 'front' ? 'auto' : 'none'}
      >
        {front}
      </Animated.View>
      <Animated.View
        style={[s.face, StyleSheet.absoluteFill, { transform: [{ perspective: TURN_TIMING.perspective }, { rotateY: backRot }] }]}
        importantForAccessibility={side === 'back' ? 'auto' : 'no-hide-descendants'}
        accessibilityElementsHidden={side !== 'back'}
        pointerEvents={side === 'back' ? 'auto' : 'none'}
      >
        {back}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  face: { backfaceVisibility: 'hidden' },
  hidden: { opacity: 0 },
});

export default HandoffTurn;
