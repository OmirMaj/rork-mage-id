// CapsuleShape.tsx: the Commit Capsule's three native pieces (moments wave, lane CAPSULE).
//
// One shape, never cut (morph.md 1). Three absolutely positioned pieces share
// one fill, vertically centred in the rail at (H − D) / 2:
//   LeftCap  a circle D at translateX = trail;
//   Body     a rect D high, base width Wb = W − 2·inset, transformOrigin left,
//            translateX = trail + D/2, scaleX = clamp((lead − trail − D)/Wb, 0, 1);
//   Head     a circle D at translateX = lead − D, scale headScale·(0.6 + 0.4·arm),
//            opacity capsuleOpacity·arm; it carries the icon stack and the drag.
// The body runs cap centre to cap centre, so both seams sit under a cap and no
// hairline can show. No width, no left, no colour is ever animated: each piece
// holds four stacked OPAQUE fill layers (base, success, danger, neutral) whose
// opacities cross-fade.
//
// The drag is the LEGACY PanGestureHandler around the HEAD only (a thumb-only
// hit area, hitSlop 12): touching the track does nothing, which protects a
// stray palm. A vertical move gives way to the sheet or the scroll view.

import React, { useMemo } from 'react';
import { Animated, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { PanGestureHandler } from 'react-native-gesture-handler';
import { CAPSULE_GEOMETRY } from '@/utils/moments/motionSpec';
import type { MomentColors, CapsuleTone } from '@/utils/moments/colors';
import type { CommitCapsule, CapsuleResultIcon, CapsuleValues } from '@/components/moments/core/useCommitCapsule';
import { CommitIconStack } from '@/components/moments/core/CommitDot';

export interface CapsuleShapeProps {
  capsule: CommitCapsule; colors: MomentColors; tone: CapsuleTone; size: 'lg' | 'md' | 'line';
  /** line skin renders 'body' (left cap + body) UNDER the pad and 'head' ABOVE it */
  part?: 'all' | 'body' | 'head';
  /** line skin dark-mode rule (multiplies caps+body, never the head) */
  bodyOpacity?: number;
  resultIcon?: CapsuleResultIcon;
  /** The head is hidden (line skin while disabled, arm 0): it takes no touches,
   *  and on web it leaves the tab order until it is back (additive). */
  headHidden?: boolean;
  /** `${testID}-head` on the head and `${testID}-focus-ring` on its ring (additive). */
  testID?: string;
}

// The head is an RN-web <button role="button">, so the app's global
// `[role='button']:focus-visible` outline (public/index.html, webDocument.ts)
// would draw a SECOND ring over ours. It has to be an inline style to beat that
// rule (a StyleSheet class loses on specificity), so it is a plain object.
const WEB_HEAD_NO_OUTLINE = { outlineWidth: 0, outlineStyle: 'none' } as unknown as ViewStyle;

function Fills({ colors, tone, values, radius, neutralBase }: {
  colors: MomentColors; tone: CapsuleTone; values: CapsuleValues; radius: number; neutralBase: boolean;
}) {
  const r = { borderRadius: radius };
  return (
    <>
      {neutralBase ? (
        <View style={[StyleSheet.absoluteFill, r, { backgroundColor: colors.neutralBase }]}>
          <View style={[StyleSheet.absoluteFill, r, { backgroundColor: colors.neutralTint, opacity: colors.neutralTintOpacity }]} />
        </View>
      ) : (
        <View style={[StyleSheet.absoluteFill, r, { backgroundColor: colors.capFill[tone] }]} />
      )}
      <Animated.View style={[StyleSheet.absoluteFill, r, { backgroundColor: colors.success, opacity: values.tone.success }]} />
      <Animated.View style={[StyleSheet.absoluteFill, r, { backgroundColor: colors.danger, opacity: values.tone.danger }]} />
      <Animated.View style={[StyleSheet.absoluteFill, r, { backgroundColor: colors.neutralBase, opacity: values.tone.neutral }]}>
        <View style={[StyleSheet.absoluteFill, r, { backgroundColor: colors.neutralTint, opacity: colors.neutralTintOpacity }]} />
      </Animated.View>
    </>
  );
}

export function CapsuleShape(p: CapsuleShapeProps): React.ReactElement | null {
  const { capsule, colors, tone } = p;
  const g = capsule.geometry;
  const v = capsule.values;
  const part = p.part ?? 'all';
  const geo = CAPSULE_GEOMETRY[p.size];
  const resultIcon = p.resultIcon ?? 'check';
  const bodyOpacity = p.bodyOpacity ?? 1;

  const nodes = useMemo(() => {
    if (!g) return null;
    const D = g.D;
    const shown = Animated.multiply(v.capsuleOpacity, v.arm);
    return {
      shown,
      bodyShown: bodyOpacity === 1 ? shown : Animated.multiply(shown, bodyOpacity),
      bodyX: Animated.add(v.trail, D / 2),
      bodyScale: Animated.subtract(Animated.subtract(v.lead, v.trail), D).interpolate({
        inputRange: [0, Math.max(1, g.Wb)], outputRange: [0, 1], extrapolate: 'clamp',
      }),
      headX: Animated.subtract(v.lead, D),
      headScale: Animated.multiply(v.headScale, v.arm.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1], extrapolate: 'clamp' })),
    };
  }, [g, v, bodyOpacity]);

  if (!g || !nodes) return null;
  const D = g.D;
  const top = (g.H - D) / 2;
  const idleLike = capsule.phase === 'idle' || capsule.phase === 'nudge';
  const disabledRest = capsule.disabled && idleLike;
  const lockShown = disabledRest && p.size !== 'line';
  const bang = capsule.plan === 'timeout' ? colors.onNeutral : colors.onDanger;
  const web = Platform.OS === 'web';

  const body = part === 'head' ? null : (
    <>
      <Animated.View
        pointerEvents="none"
        style={[styles.piece, { top, width: D, height: D, opacity: nodes.bodyShown, transform: [{ translateX: v.trail }] }]}
      >
        <Fills colors={colors} tone={tone} values={v} radius={D / 2} neutralBase={disabledRest} />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.piece,
          {
            top, width: Math.max(1, g.Wb), height: D, opacity: nodes.bodyShown,
            transformOrigin: 'left', transform: [{ translateX: nodes.bodyX }, { scaleX: nodes.bodyScale }],
          },
        ]}
      >
        <Fills colors={colors} tone={tone} values={v} radius={0} neutralBase={disabledRest} />
      </Animated.View>
    </>
  );

  // Keyboard (web/desktop): the head is focusable; Space/Enter hold fills it.
  // A HIDDEN head (line skin, not ready) is no tab stop: nobody can see it, and
  // the readiness line under the signature line says what is missing. RN-web
  // turns aria-disabled into a native `disabled`, so it cannot take focus.
  const keyProps: Record<string, unknown> = !web
    ? {}
    : p.headHidden
      ? { focusable: false, 'aria-disabled': true, 'aria-hidden': true }
      : { focusable: true, onKeyDown: capsule.keyboard.onKeyDown, onKeyUp: capsule.keyboard.onKeyUp,
          onFocus: capsule.keyboard.onFocus, onBlur: capsule.keyboard.onBlur };
  const ringOn = capsule.focused && !p.headHidden;
  // In screen-reader mode the whole track is the one button (the skin owns it).
  const a11yProps: Record<string, unknown> = capsule.screenReader
    ? { accessible: false, importantForAccessibility: 'no-hide-descendants' }
    : { ...capsule.headA11yProps, ref: capsule.headRef };

  const head = part === 'body' ? null : (
    <PanGestureHandler
      onGestureEvent={capsule.gestureProps.onGestureEvent}
      onHandlerStateChange={capsule.gestureProps.onHandlerStateChange}
      activeOffsetX={[capsule.gestureProps.activeOffsetX[0], capsule.gestureProps.activeOffsetX[1]]}
      failOffsetY={[capsule.gestureProps.failOffsetY[0], capsule.gestureProps.failOffsetY[1]]}
      hitSlop={capsule.gestureProps.hitSlop}
      enabled={capsule.gestureProps.enabled && !p.headHidden}
    >
      <Animated.View
        pointerEvents={p.headHidden ? 'none' : 'auto'}
        {...a11yProps}
        {...keyProps}
        testID={p.testID ? `${p.testID}-head` : undefined}
        style={[
          styles.piece,
          {
            top, width: D, height: D, borderRadius: D / 2, opacity: nodes.shown,
            transform: [{ translateX: nodes.headX }, { scale: nodes.headScale }],
          },
          web ? WEB_HEAD_NO_OUTLINE : null,
        ]}
      >
        <Fills colors={colors} tone={tone} values={v} radius={D / 2} neutralBase={disabledRest} />
        <CommitIconStack
          values={v}
          D={D}
          icon={geo.icon}
          checkW={geo.checkW}
          checkH={geo.checkH}
          ringInset={geo.ringInset}
          resultIcon={resultIcon}
          lockShown={lockShown}
          colors={{ capOn: colors.capOn[tone], onSuccess: colors.onSuccess, bang, onNeutral: colors.onNeutral, lockMuted: colors.label }}
        />
        {ringOn ? (
          // Keyboard focus only (web): ONE 2 pt focus-colour ring 3 pt off the
          // HEAD, riding it (morph.html .head:focus-visible), in both skins. A
          // mouse press never draws it; the browser outline is suppressed above.
          <View
            pointerEvents="none"
            style={[styles.headRing, { borderRadius: D / 2 + 5, borderColor: colors.focus }]}
            testID={p.testID ? `${p.testID}-focus-ring` : undefined}
          />
        ) : null}
      </Animated.View>
    </PanGestureHandler>
  );

  return (
    <>
      {body}
      {head}
    </>
  );
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', left: 0 },
  headRing: { position: 'absolute', top: -5, left: -5, right: -5, bottom: -5, borderWidth: 2 },
});
