// LetterFold — the GC's sign-and-send: after the seal lands, the signature
// panel folds up over the contract like a letter, and the seal rides to the
// hinge to hold it closed. Its back face is the sent card.
//
// 3D (iOS, web): each face rotates on its own about the hinge (the panel's top
// edge) with backfaceVisibility 'hidden'. rotateX 0 -> 180deg, 560 ms on the
// FOLD curve, native driver. The front face is rotateX(a); the back face is
// rotateX(a) · translateY(P) · rotateX(180deg), i.e. the preview's "back face
// pre-rotated 180deg about its own centre", expressed about the hinge so the
// face can carry its own transform. Rotating the faces, not a shared parent, is
// what hides the far side on iOS (a rotated parent's children are flattened).
//
// SIGN. Positive rotateX, like the preview's CSS: RN's rotateX matrix is CSS's
// (cos, sin / -sin, cos in rows 2-3) and RN-web hands the transform to CSS, so
// the flap swings TOWARD the viewer and up over the top panel. Unverified on a
// device (no simulator this run).
//
// Android and Reduce Motion: NO rotateX anywhere. The front face fades out
// (200) while the back face, placed above the hinge, fades in; the seal hops to
// the hinge while hidden. The crease haptic and the announcement stay.
//
// The ONE layout change in the signing moments: after the crease the card
// collapses 416 -> 208 through layoutNext() + a state change (never an
// Animated height).

import React, { useCallback, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { layoutNext, nativeDriver, reducedMotion, useReducedMotion } from '@/components/ui/motion';
import { can3DFor } from '@/utils/moments/platform3d';
import { FOLD_TIMING, SIGN_EASE } from '@/utils/moments/signTimeline';
import { momentHaptic, announce } from '@/utils/moments/haptics';

const FOLD_EASE = Easing.bezier(SIGN_EASE.fold[0], SIGN_EASE.fold[1], SIGN_EASE.fold[2], SIGN_EASE.fold[3]);

export interface LetterFoldPlay {
  /** ctx.wait from the capsule: rejects when the moment is aborted. */
  wait: (ms: number) => Promise<void>;
  /** The name / consent fields go to opacity 0. */
  onFieldsHide: () => void;
  /** Move the seal to the hinge: animated (springs) or set. */
  sealToHinge: (animated: boolean) => void;
  /** Seal opacity for the cross-fade path. */
  sealFade: (to: 0 | 1, ms: number) => void;
  /** Announced when the letter is closed, e.g. "Contract signed and sent to Jane Smith". */
  say?: string;
}

export interface LetterFoldControl {
  angle: Animated.Value;
  frontO: Animated.Value;
  backO: Animated.Value;
  /** True after the collapse: the card is one panel tall. */
  folded: boolean;
  play: (o: LetterFoldPlay) => Promise<void>;
  reset: () => void;
}

export function useLetterFold(): LetterFoldControl {
  const angle = useRef(new Animated.Value(0)).current;
  const frontO = useRef(new Animated.Value(1)).current;
  const backO = useRef(new Animated.Value(0)).current;
  const [folded, setFolded] = useState(false);

  // The ONE layout change: the card collapses to one panel.
  const collapse = useCallback(() => {
    layoutNext();
    setFolded(true);
  }, []);

  const play = useCallback(
    async (o: LetterFoldPlay) => {
      o.onFieldsHide();
      const threeD = can3DFor(Platform.OS) && !reducedMotion();
      if (threeD) {
        backO.setValue(1);
        Animated.timing(angle, {
          toValue: 180,
          duration: FOLD_TIMING.fold,
          easing: FOLD_EASE,
          useNativeDriver: nativeDriver,
        }).start();
        o.sealToHinge(true);
        await o.wait(FOLD_TIMING.creaseAt);
        momentHaptic('light');
        await o.wait(FOLD_TIMING.collapseAt - FOLD_TIMING.creaseAt);
        collapse();
      } else {
        // Cross-fade: never a rotateX.
        o.sealFade(0, FOLD_TIMING.xfSealOut);
        await o.wait(FOLD_TIMING.xfSealOut);
        Animated.parallel([
          Animated.timing(frontO, { toValue: 0, duration: FOLD_TIMING.xfFace, useNativeDriver: nativeDriver }),
          Animated.timing(backO, { toValue: 1, duration: FOLD_TIMING.xfFace, useNativeDriver: nativeDriver }),
        ]).start();
        await o.wait(FOLD_TIMING.xfFace);
        angle.setValue(180);
        o.sealToHinge(false);
        momentHaptic('light');
        collapse();
        o.sealFade(1, FOLD_TIMING.xfSealIn);
        await o.wait(FOLD_TIMING.xfSealIn);
      }
      if (o.say) announce(o.say);
    },
    [angle, frontO, backO, collapse],
  );

  const reset = useCallback(() => {
    angle.setValue(0);
    frontO.setValue(1);
    backO.setValue(0);
    setFolded(false);
  }, [angle, frontO, backO]);

  return { angle, frontO, backO, folded, play, reset };
}

export interface LetterFoldProps {
  control: LetterFoldControl;
  /** Panel height (208). The flap is placed one panel down. */
  panel: number;
  front: React.ReactNode;
  back?: React.ReactNode;
  frontStyle?: StyleProp<ViewStyle>;
  backStyle?: StyleProp<ViewStyle>;
  /** A near-black token in both themes (light: text, dark: bg). */
  shadeColor: string;
  testID?: string;
}

export function LetterFold({ control, panel, front, back, frontStyle, backStyle, shadeColor, testID }: LetterFoldProps) {
  const reduced = useReducedMotion();
  const threeD = can3DFor(Platform.OS) && !reduced;
  const { angle, frontO, backO, folded } = control;

  const frontShade = angle.interpolate({
    inputRange: [0, 90, 180],
    outputRange: [0, FOLD_TIMING.shadeMax, FOLD_TIMING.shadeMax],
    extrapolate: 'clamp',
  });
  const backShade = angle.interpolate({
    inputRange: [0, 90, 180],
    outputRange: [FOLD_TIMING.shadeMax, FOLD_TIMING.shadeMax, 0],
    extrapolate: 'clamp',
  });
  const rot = angle.interpolate({ inputRange: [0, 180], outputRange: ['0deg', '180deg'] });

  const frontTransform = threeD ? [{ perspective: FOLD_TIMING.perspective }, { rotateX: rot }] : undefined;
  const backTransform = threeD
    ? [{ perspective: FOLD_TIMING.perspective }, { rotateX: rot }, { translateY: panel }, { rotateX: '180deg' }]
    : [{ translateY: -panel }];

  return (
    <View style={[s.flap, { top: panel, height: panel }]} testID={testID} pointerEvents="box-none">
      <Animated.View
        style={[s.face, frontStyle, { opacity: frontO, transformOrigin: 'top', transform: frontTransform }]}
        importantForAccessibility={folded ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={folded}
        pointerEvents={folded ? 'none' : 'auto'}
      >
        {front}
        <Animated.View style={[s.shade, { backgroundColor: shadeColor, opacity: threeD ? frontShade : 0 }]} pointerEvents="none" />
      </Animated.View>
      {back != null ? (
        <Animated.View
          style={[s.face, backStyle, { opacity: backO, transformOrigin: 'top', transform: backTransform }]}
          importantForAccessibility={folded ? 'auto' : 'no-hide-descendants'}
          accessibilityElementsHidden={!folded}
          pointerEvents={folded ? 'auto' : 'none'}
        >
          {back}
          <Animated.View style={[s.shade, { backgroundColor: shadeColor, opacity: threeD ? backShade : 0 }]} pointerEvents="none" />
        </Animated.View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  flap: { position: 'absolute', left: 0, right: 0, zIndex: 5 },
  // overflow hidden: the shade (no radius of its own) is clipped to each face's own corners.
  face: { ...StyleSheet.absoluteFillObject, backfaceVisibility: 'hidden', overflow: 'hidden' },
  shade: StyleSheet.absoluteFillObject,
});

export default LetterFold;
