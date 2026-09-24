// components/tutorial/TutorialLayer.tsx — where the coach draws.
//
// ONE PER HOST. 'root' is mounted once by <TutorialHost/> in app/_layout.tsx
// (zIndex 9500: above NailItToast at 9000, below Confetti at 9999; AlertHost is
// a Modal so alerts always draw above it). The others are mounted as the LAST
// child INSIDE a modal — <TutorialLayer host="planPin" /> in PlanPinStep's
// full-screen Modal — because on iOS a native-stack modal route or an RN
// <Modal> draws ABOVE the root layer; a spotlight on a control inside the
// modal has to be drawn inside it too. Only the layer that owns the current
// view draws anything, so no dim ever appears under (or over) a modal the
// step does not own.
//
// THE SPOTLIGHT is four absolutely positioned dim rects around an EMPTY hole.
// The real control under the hole receives the real touch — no forwarding,
// no fake button. The dims catch everything else: a tap on them never
// advances or exits; it shakes the card 6 px, replays the hand and ticks a
// selection haptic, so a wrong tap teaches instead of doing nothing.
// Moving between targets animates the hole (280 ms, standard curve, JS driver
// across the four rects) so the eye follows it, like the spot sliding to the
// tab in the reference video. Reduce Motion: it jumps.
//
// With a screen reader on there are NO dims (VoiceOver / TalkBack must reach
// every control): the host puts the view in card mode.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LayerId, Rect, RunState, Size } from '@/utils/tutorial/types';
import { Colors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { handPoint, placeCard } from '@/utils/tutorial/placement';
import {
  registerTutorialLayer,
  tutorialUi,
  unregisterTutorialLayer,
  useTutorialPresentation,
  useTutorialRun,
  type MeasurableNode,
  type TutorialPresentation,
} from '@/utils/tutorial/store';
import { CoachCard } from './CoachCard';
import { GestureHand } from './GestureHand';
import { SuccessStamp } from './SuccessStamp';
import { FinaleCard } from './FinaleCard';
import { PausedPill } from './PausedPill';
import { Type } from '@/constants/typography';

const MOVE_MS = Tokens.motion.duration.base;
const MOVE_EASING = Easing.bezier(0.4, 0, 0.2, 1);
const WIDE_MIN = 768;

const isRunning = (s: RunState) => s.status === 'running';

export function TutorialLayer({ host }: { host: LayerId }) {
  const running = useTutorialRun(isRunning);
  const p = useTutorialPresentation();
  const token = useRef<object>({}).current;
  const nodeRef = useRef<MeasurableNode | null>(null);
  const [size, setSize] = useState<Size | null>(null);

  // Registered as mounted from the first render, even while idle and drawing
  // nothing: a MODAL layer's mount is itself a fact the coach needs (a root
  // step hides while another modal's layer is up).
  useEffect(() => {
    registerTutorialLayer(host, token, nodeRef.current, size);
    return () => unregisterTutorialLayer(host, token);
  }, [host, token, size]);

  const setNode = useCallback(
    (node: View | null) => {
      nodeRef.current = node as MeasurableNode | null;
      registerTutorialLayer(host, token, nodeRef.current, size);
    },
    [host, token, size],
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize(prev => (prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  }, []);

  // Idle cost: nothing drawn. The root layer also shows the short exit toast
  // after a run ends.
  const showToast = host === 'root' && !!p.toast;
  if (!running && !showToast) return null;

  const view = p.view;
  const mine =
    ((view.kind === 'spotlight' || view.kind === 'card' || view.kind === 'celebrate') && view.layer === host) ||
    (host === 'root' && (view.kind === 'finale' || (view.kind === 'paused' && view.onSample)));

  return (
    <View
      ref={setNode}
      collapsable={false}
      onLayout={onLayout}
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, host === 'root' ? styles.rootZ : styles.modalZ]}
      testID={`tutorial-layer-${host}`}
    >
      {running && mine && size ? <LayerContent host={host} p={p} size={size} /> : null}
      {showToast ? <ExitToast text={p.toast!} /> : null}
    </View>
  );
}

function LayerContent({ host, p, size }: { host: LayerId; p: TutorialPresentation; size: Size }) {
  const insets = useSafeAreaInsets();
  const view = p.view;
  const wide = size.w >= WIDE_MIN;

  if (view.kind === 'finale' && p.finale) {
    return <FinaleCard finale={p.finale} reduceMotion={p.reduceMotion} wide={wide} onAction={k => tutorialUi().finaleAction(k)} />;
  }
  if (view.kind === 'paused') {
    return <PausedPill top={insets.top + 6} onResume={() => tutorialUi().resume()} onEnd={() => tutorialUi().exit('skip')} />;
  }
  if (view.kind === 'celebrate' && p.celebrate) {
    return (
      <SuccessStamp
        key={p.stepId ?? 'stamp'}
        title={p.celebrate.title}
        sub={p.celebrate.sub}
        reduceMotion={p.reduceMotion}
        onDone={() => tutorialUi().celebrationDone()}
      />
    );
  }
  if (view.kind === 'spotlight' || view.kind === 'card') {
    // Keyed by layer, NOT by step: the same hole moving from one target to
    // the next is what lets the eye follow it.
    return <Spotlight key={host} p={p} size={size} insets={insets} wide={wide} />;
  }
  return null;
}

// ── The spotlight (and card mode, which is the spotlight minus dims) ───────

function Spotlight({
  p,
  size,
  insets,
  wide,
}: {
  p: TutorialPresentation;
  size: Size;
  insets: { top: number; bottom: number };
  wide: boolean;
}) {
  const { colors } = useTheme();
  const spot = p.view.kind === 'spotlight' && p.hole && !p.screenReader;
  const hole: Rect = p.hole ?? { x: size.w / 2, y: size.h / 2, w: 0, h: 0 };

  // Hole geometry, JS driver: it drives top/left/width/height of four views.
  const hx = useRef(new Animated.Value(hole.x)).current;
  const hy = useRef(new Animated.Value(hole.y)).current;
  const hw = useRef(new Animated.Value(hole.w)).current;
  const hh = useRef(new Animated.Value(hole.h)).current;
  const fade = useRef(new Animated.Value(p.reduceMotion ? 1 : 0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const cardX = useRef(new Animated.Value(0)).current;
  const cardY = useRef(new Animated.Value(0)).current;
  const [cardH, setCardH] = useState(0);
  const placedOnce = useRef(false);
  const lastHole = useRef<Rect | null>(null);

  // The layer's content appears (first spotlight here, or a switch from
  // another layer): cross-fade in over 150 ms.
  useEffect(() => {
    if (p.reduceMotion) return;
    const a = Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the hole. Sub-pixel re-measures are ignored so the 250 ms poll
  // does not keep restarting an animation that has nowhere to go.
  useEffect(() => {
    if (!p.hole) return;
    const prev = lastHole.current;
    lastHole.current = p.hole;
    if (prev && Math.abs(prev.x - p.hole.x) < 1 && Math.abs(prev.y - p.hole.y) < 1 && Math.abs(prev.w - p.hole.w) < 1 && Math.abs(prev.h - p.hole.h) < 1) return;
    if (!prev || p.reduceMotion) {
      hx.setValue(p.hole.x); hy.setValue(p.hole.y); hw.setValue(p.hole.w); hh.setValue(p.hole.h);
      return;
    }
    const cfg = { duration: MOVE_MS, easing: MOVE_EASING, useNativeDriver: false } as const;
    const a = Animated.parallel([
      Animated.timing(hx, { toValue: p.hole.x, ...cfg }),
      Animated.timing(hy, { toValue: p.hole.y, ...cfg }),
      Animated.timing(hw, { toValue: p.hole.w, ...cfg }),
      Animated.timing(hh, { toValue: p.hole.h, ...cfg }),
    ]);
    a.start();
    return () => a.stop();
  }, [p.hole?.x, p.hole?.y, p.hole?.w, p.hole?.h, p.reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  // The ring's slow pulse (native driver, its own view — a view cannot mix
  // native- and JS-driven props).
  useEffect(() => {
    if (p.reduceMotion || !spot) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [p.reduceMotion, spot, pulse]);

  // A tap on the dim: shake 6 px (the hand replays off the same nudge).
  const firstNudge = useRef(p.nudge);
  useEffect(() => {
    if (p.nudge === firstNudge.current) return;
    shake.setValue(0);
    if (p.reduceMotion) return;
    const s = (v: number) => Animated.timing(shake, { toValue: v, duration: 50, useNativeDriver: true });
    const a = Animated.sequence([s(6), s(-6), s(4), s(-4), s(0)]);
    a.start();
    return () => a.stop();
  }, [p.nudge, p.reduceMotion, shake]);

  // Card placement from the measured card height.
  const placement = spot && p.hole
    ? placeCard({ hole: p.hole, cardH, layer: size, insets, keyboardH: p.keyboardH, wide })
    : placeCard({ hole: { x: 0, y: 0, w: size.w, h: size.h }, cardH, layer: size, insets, keyboardH: p.keyboardH, wide });
  useEffect(() => {
    if (!placedOnce.current || p.reduceMotion) {
      cardX.setValue(placement.x);
      cardY.setValue(placement.y);
      if (cardH > 0) placedOnce.current = true;
      return;
    }
    const cfg = { duration: MOVE_MS, easing: MOVE_EASING, useNativeDriver: false } as const;
    const a = Animated.parallel([
      Animated.timing(cardX, { toValue: placement.x, ...cfg }),
      Animated.timing(cardY, { toValue: placement.y, ...cfg }),
    ]);
    a.start();
    return () => a.stop();
  }, [placement.x, placement.y, cardH, p.reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDim = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
    tutorialUi().dimPressed();
  }, []);

  const caret =
    spot && placement.caretX !== null && placement.side !== 'top'
      ? { x: placement.caretX, side: placement.side === 'below' ? ('top' as const) : ('bottom' as const) }
      : null;

  const now = Date.now();
  const showHand =
    spot && p.hole && p.gesture !== 'none' && now >= p.handHiddenUntil && cardH > 0;
  const fingertip = showHand && p.hole ? handPoint(p.hole, p.gesture, p.targetRect, p.point) : null;
  const handFrom =
    p.gesture === 'tap-point' ? { x: placement.x + placement.width / 2, y: placement.y + cardH / 2 } : null;

  // The dims answer touches through the responder system instead of being
  // Pressables: they are not controls (hidden from accessibility) and only
  // need "a touch landed here".
  const dimResponder = {
    onStartShouldSetResponder: () => true,
    onResponderRelease: onDim,
  };
  const dimStyle = { backgroundColor: Colors.overlay };

  return (
    <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { opacity: fade }]}>
      {spot ? (
        <View
          pointerEvents="box-none"
          style={StyleSheet.absoluteFill}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID="tutorial-dims"
        >
          <Animated.View {...dimResponder} testID="tutorial-dim-top" style={[styles.dim, dimStyle, { left: 0, right: 0, top: 0, height: hy }]} />
          <Animated.View {...dimResponder} testID="tutorial-dim-bottom" style={[styles.dim, dimStyle, { left: 0, right: 0, top: Animated.add(hy, hh), bottom: 0 }]} />
          <Animated.View {...dimResponder} testID="tutorial-dim-left" style={[styles.dim, dimStyle, { left: 0, top: hy, height: hh, width: hx }]} />
          <Animated.View {...dimResponder} testID="tutorial-dim-right" style={[styles.dim, dimStyle, { left: Animated.add(hx, hw), right: 0, top: hy, height: hh }]} />
          {/* The ring: 2 px accent plus a 4 px surface halo at 40 %. Drawn
              in the hole's padding, so it never covers the control. */}
          <Animated.View pointerEvents="none" style={[styles.dim, { left: hx, top: hy, width: hw, height: hh }]}>
            <View style={[styles.halo, { borderColor: colors.surface, borderRadius: p.holeRadius + 4 }]} />
            <Animated.View
              style={[StyleSheet.absoluteFill, styles.ring, { borderColor: colors.accentFill, borderRadius: p.holeRadius, opacity: pulse }]}
            />
          </Animated.View>
        </View>
      ) : null}

      {fingertip ? (
        <GestureHand
          point={fingertip}
          from={handFrom}
          gesture={p.gesture === 'tap-point' ? 'tap-point' : 'tap'}
          pointerFine={p.pointerFine}
          reduceMotion={p.reduceMotion}
          replayKey={p.nudge}
        />
      ) : null}

      <Animated.View
        pointerEvents="box-none"
        style={[styles.cardPos, { left: cardX, top: cardY, opacity: cardH > 0 ? 1 : 0 }]}
      >
        <CoachCard
          stepNumber={p.stepNumber}
          stepCount={p.stepCount}
          text={p.text}
          detail={p.detail}
          next={p.next}
          skip={p.skip}
          missing={p.view.kind === 'card' && p.view.reason === 'missing'}
          assist={!!p.assist}
          failureReason={p.failureReason}
          scrollHint={p.view.kind === 'card' && p.view.reason === 'offscreen' ? p.view.scroll ?? null : null}
          caret={caret}
          width={placement.width}
          shake={shake}
          onHeight={h => setCardH(prev => (Math.abs(prev - h) < 1 ? prev : h))}
          onNext={() => tutorialUi().next()}
          onSkip={() => tutorialUi().skipStep()}
          onAssist={() => tutorialUi().assist()}
          onExit={() => tutorialUi().exit('skip')}
        />
      </Animated.View>
    </Animated.View>
  );
}

// ── Exit toast ('Tutorial closed — replay it from Help → Tutorials') ───────

function ExitToast({ text }: { text: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none" style={[styles.toastWrap, { bottom: insets.bottom + 24 }]} testID="tutorial-exit-toast">
      <View style={[styles.toast, Tokens.shadow.medium, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[Type.footnoteEmphasized, { color: colors.text }]} accessibilityLiveRegion="polite">
          {text}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rootZ: { zIndex: 9500, elevation: 24 },
  modalZ: { zIndex: 9500, elevation: 24 },
  dim: { position: 'absolute' },
  halo: { position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderWidth: 4, opacity: 0.4 },
  ring: { borderWidth: 2 },
  cardPos: { position: 'absolute' },
  toastWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: { borderWidth: 1, borderRadius: Tokens.radius.full, paddingHorizontal: 16, paddingVertical: 10 },
});

export default TutorialLayer;
