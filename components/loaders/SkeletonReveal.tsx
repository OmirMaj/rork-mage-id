// SkeletonReveal — the skeleton → content hand-off.
//
//   <SkeletonReveal ready={!!rows} skeleton={<ListSkeleton count={3} />}>
//     {() => rows!.map((r, i) => <Row key={r.id} delayMs={revealStagger(i)} … />)}
//   </SkeletonReveal>
//
// - ready at MOUNT (cached / local data) → the children only: no skeleton, no
//   wrapper, no animation (local-first; golden-stable for every cached read).
// - otherwise CORE's gate, scope 'skeleton' (hooks/useLoadingGate: 100 ms
//   reveal, 400 ms minimum hold). The skeleton's own fade-in is baked into ONE
//   timing on a wrapper — a 100 ms plateau, then 120 ms of opacity — so data
//   that lands inside the first 100 ms shows NO skeleton and the content
//   appears plainly (no Arrive).
// - on ready (after any hold) the skeleton drops ABSOLUTELY under the content
//   and fades 1 → 0 over 120 ms ACCELERATE, while the content arrives through
//   CORE's <Arrive armed after="fade"> (opacity 0 → 1 + translateY 6 → 0 over
//   200 ms DECELERATE). Nothing jumps: the skeleton stops taking layout the
//   same frame the content starts taking it.
// - children may be a render function (JSX children evaluate eagerly — pass a
//   function when they dereference data that is undefined until ready).
//
// A list host may stagger its first rows with revealStagger(index): 30 ms
// apart for the first six, no delay from the seventh on. Every timing is
// CORE's (utils/levelTimeline.ts LOADER); native driver.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { nativeDriver } from '@/components/ui/motion';
import { useLoadingGate } from '@/hooks/useLoadingGate';
import { ACCELERATE, DECELERATE, LOADER, plateau } from '@/utils/levelTimeline';
import Arrive from './Arrive';

export interface SkeletonRevealProps {
  ready: boolean;
  /** The placeholder, shaped exactly like the content (Skeleton / SkeletonRow / SkeletonCard …). */
  skeleton: React.ReactNode;
  children?: React.ReactNode | (() => React.ReactNode);
  testID?: string;
}

/** How many leading rows stagger in, and how far apart. */
export const REVEAL_STAGGER_ROWS = 6;
export const REVEAL_STAGGER_MS = 30;

/** A list row's arrival delay: 30 ms apart for the first six rows, then none. */
export function revealStagger(index: number): number {
  if (!Number.isFinite(index) || index < 0 || index >= REVEAL_STAGGER_ROWS) return 0;
  return Math.floor(index) * REVEAL_STAGGER_MS;
}

const renderChildren = (c: SkeletonRevealProps['children']) => (typeof c === 'function' ? (c as () => React.ReactNode)() : c);

export default function SkeletonReveal(props: SkeletonRevealProps) {
  const [readyAtMount] = useState(props.ready);
  if (readyAtMount) return <>{renderChildren(props.children)}</>;
  return <SkeletonRevealGated {...props} />;
}

function SkeletonRevealGated({ ready, skeleton, children, testID = 'skeleton-reveal' }: SkeletonRevealProps) {
  const gate = useLoadingGate(!ready, 'skeleton');
  const revealMs = LOADER.gate.skeleton.delayMs;
  const fadeMs = LOADER.fadeExitMs;

  // Sticky: once the content has mounted it never unmounts.
  const contentMounted = useRef(false);
  if (ready && (!gate.show || gate.exiting)) contentMounted.current = true;

  // The skeleton wrapper: hidden on frame 0; ONE timing = 100 ms plateau + 120 ms fade.
  const skelO = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const total = revealMs + fadeMs;
    const a = Animated.timing(skelO, {
      toValue: 1, duration: total, easing: plateau(revealMs / total, DECELERATE), useNativeDriver: nativeDriver,
    });
    a.start();
    return () => a.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The exit: 1 → 0 over 120 ms ACCELERATE, then tell the gate (its backstop covers a lost callback).
  const onExited = gate.onExited;
  useEffect(() => {
    if (!gate.exiting) return;
    const a = Animated.timing(skelO, { toValue: 0, duration: fadeMs, easing: ACCELERATE, useNativeDriver: nativeDriver });
    a.start(({ finished }) => { if (finished) onExited(); });
    return () => a.stop();
  }, [gate.exiting, skelO, fadeMs, onExited]);

  // A restart (not ready again while holding / exiting) brings the skeleton back to full, no second delay.
  const wasExiting = useRef(false);
  useEffect(() => {
    const was = wasExiting.current;
    wasExiting.current = gate.exiting;
    if (!was || gate.exiting || !gate.show) return;
    Animated.timing(skelO, { toValue: 1, duration: fadeMs, easing: DECELERATE, useNativeDriver: nativeDriver }).start();
  }, [gate.exiting, gate.show, skelO, fadeMs]);

  const content = contentMounted.current;
  return (
    <View testID={testID}>
      {gate.show && (
        <Animated.View
          testID={`${testID}-skeleton`}
          pointerEvents="none"
          style={content ? [StyleSheet.absoluteFill, { opacity: skelO }] : { opacity: skelO }}
        >
          {skeleton}
        </Animated.View>
      )}
      {content && (
        <Arrive armed={gate.wasShown} after="fade" testID={`${testID}-content`}>
          {renderChildren(children)}
        </Arrive>
      )}
    </View>
  );
}
