// SignatureLine — the LINE skin of the Commit Capsule: you sign above the
// line, the X at its left end becomes the capsule head, you slide ALONG the
// signature line, and the line winds into the busy circle.
//
// Two layers around the SignaturePad (the pad is transparent between them):
//   layer "under": the grooves (cool line, and the warm line that cross-fades
//                  in on the first pen-down) + the capsule's 'body' part.
//   layer "over":  the X mark, the capsule's 'head' part (its PanGestureHandler
//                  sits above the pad, so a touch on the head goes to the
//                  capsule, never the pad), the label / busy / reason row and
//                  the screen-reader Confirm/Cancel bar.
// Both layers draw the same 56 pt zone at top 110 of the bottom panel; only the
// under layer measures it (capsule.onRailLayout).
//
// The groove is consumed as the trail travels right: scaleX from the right
// edge, trail [inset, W - inset - D/2] -> [1, 0], on the native driver.
//
// DARK MODE (judge MUSTFIX): the capsule body under the ink is drawn at 0.45
// opacity when the theme is dark, so ink never sits on a low-contrast frame.
// The head is never dimmed.

import React, { useMemo } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Type } from '@/constants/typography';
import { CapsuleShape, type CommitCapsule } from '@/components/moments/core/contract';
import type { MomentColors } from '@/utils/moments/colors';
import { labelOpacityTable } from '@/utils/moments/capsuleMath';
import { LINE_GEOMETRY as G } from '@/utils/moments/signTimeline';

export interface SignatureLineProps {
  capsule: CommitCapsule;
  layer: 'under' | 'over';
  colors: MomentColors;
  resolved: 'light' | 'dark';
  /** The line's label when ready ("Slide along the line to sign"). */
  label: string;
  /** The screen-reader Confirm segment's text ("Confirm signing the contract"). */
  srConfirm: string;
  /** The first missing step (shown in the label slot while disabled). */
  readiness: string | null;
  /** 0 -> 1 when the pen first touches (the line acknowledges it). */
  warm?: Animated.Value;
  /** Show the X (drawn and typed modes both have one). */
  showX?: boolean;
  testID?: string;
}

/** The dark-mode body dim, as a pure rule. */
export function lineBodyOpacity(resolved: 'light' | 'dark'): number {
  return resolved === 'dark' ? 0.45 : 1;
}

export function SignatureLine(p: SignatureLineProps) {
  return p.layer === 'under' ? <Under {...p} /> : <Over {...p} />;
}

function Under({ capsule, colors: mc, resolved, warm, testID }: SignatureLineProps) {
  const g = capsule.geometry;
  const grooveScale = useMemo(() => {
    if (!g) return 1;
    const end = g.W - g.inset - g.D / 2;
    return capsule.values.trail.interpolate({
      inputRange: [g.inset, Math.max(g.inset + 1, end)],
      outputRange: [1, 0],
      extrapolate: 'clamp',
    });
  }, [g, capsule.values.trail]);
  const bodyOpacity = lineBodyOpacity(resolved);

  return (
    <View style={s.zone} onLayout={capsule.onRailLayout} pointerEvents="none" testID={testID ? `${testID}-under` : undefined}>
      <Animated.View style={[s.groove, { backgroundColor: mc.groove, transform: [{ scaleX: grooveScale }] }]} />
      {warm ? (
        <Animated.View
          style={[s.groove, { backgroundColor: mc.grooveWarm, opacity: warm, transform: [{ scaleX: grooveScale }] }]}
        />
      ) : null}
      <CapsuleShape capsule={capsule} colors={mc} tone="brand" size="line" part="body" bodyOpacity={bodyOpacity} />
    </View>
  );
}

function Over({ capsule, colors: mc, label, srConfirm, readiness, showX = true, testID }: SignatureLineProps) {
  const v = capsule.values;
  const xOpacity = useMemo(() => v.arm.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' }), [v.arm]);
  const labelOpacity = useMemo(() => {
    const t = labelOpacityTable();
    return Animated.multiply(v.label, v.progress.interpolate({ inputRange: t.inputRange, outputRange: t.outputRange, extrapolate: 'clamp' }));
  }, [v.label, v.progress]);
  const idle = capsule.phase === 'idle' || capsule.phase === 'nudge' || capsule.phase === 'drag';
  const labelText = capsule.disabled && readiness ? readiness : label;
  // A stale failure reason never hides the readiness step: once the line is
  // disabled (offline, ink cleared), what is missing now wins the slot.
  const reason = capsule.disabled && readiness ? null : capsule.reason;
  const sr = capsule.screenReader;

  return (
    <View style={s.zone} pointerEvents="box-none" testID={testID ? `${testID}-over` : undefined}>
      {showX ? (
        <Animated.Text style={[s.x, { color: mc.label, opacity: xOpacity }]} accessibilityElementsHidden importantForAccessibility="no">
          X
        </Animated.Text>
      ) : null}
      <CapsuleShape capsule={capsule} colors={mc} tone="brand" size="line" part="head" headHidden={capsule.disabled} testID={testID} />
      {sr && !capsule.srOpen && idle ? (
        <Pressable
          // CapsuleShape does not attach headRef in screen-reader mode; this
          // button is the focus-return target for Cancel.
          ref={capsule.headRef}
          style={s.srButton}
          accessibilityRole="button"
          {...(capsule.headA11yProps as object)}
          onPress={capsule.openConfirm}
          testID={testID ? `${testID}-sr` : undefined}
        />
      ) : null}
      {reason && !capsule.srOpen ? (
        <Animated.Text
          style={[
            s.reason,
            { color: reason.tone === 'warning' ? mc.reasonWarning : mc.reasonDanger, opacity: v.reason, transform: [{ translateY: v.reasonY }] },
          ]}
          numberOfLines={1}
          accessibilityLiveRegion="polite"
          testID={testID ? `${testID}-reason` : undefined}
        >
          {reason.text}
        </Animated.Text>
      ) : !capsule.srOpen ? (
        <Animated.Text
          style={[s.label, { color: mc.label, opacity: capsule.disabled ? 1 : labelOpacity }]}
          numberOfLines={1}
          accessibilityLiveRegion={capsule.disabled ? 'polite' : 'none'}
          testID={testID ? `${testID}-label` : undefined}
        >
          {labelText}
        </Animated.Text>
      ) : null}
      <Animated.Text style={[s.label, { color: mc.busy, opacity: v.busy }]} numberOfLines={1} importantForAccessibility="no">
        Signing…
      </Animated.Text>
      {capsule.srOpen ? (
        <Animated.View style={[s.srBar, { opacity: v.sr }]}>
          <Pressable
            ref={capsule.confirmRef}
            onPress={capsule.confirm}
            accessibilityRole="button"
            style={[s.srOk, { backgroundColor: mc.capFill.brand }]}
            testID={testID ? `${testID}-sr-confirm` : undefined}
          >
            <Text style={[s.srText, { color: mc.capOn.brand }]} numberOfLines={1}>
              {srConfirm}
            </Text>
          </Pressable>
          <Pressable
            onPress={capsule.cancel}
            accessibilityRole="button"
            style={[s.srNo, { borderColor: mc.rim }]}
            testID={testID ? `${testID}-sr-cancel` : undefined}
          >
            <Text style={[s.srText, { color: mc.ink }]} numberOfLines={1}>
              Cancel
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  zone: { position: 'absolute', left: 0, right: 0, top: G.zoneTop, height: G.zoneH },
  groove: {
    position: 'absolute',
    left: G.inset,
    right: G.inset,
    top: G.grooveTop,
    height: G.grooveH,
    borderRadius: 1,
    transformOrigin: 'right',
  },
  x: { ...Type.subheadline, fontWeight: '600', position: 'absolute', left: G.xLeft, top: G.xTop - G.zoneTop },
  label: {
    ...Type.footnoteEmphasized,
    position: 'absolute',
    left: G.inset,
    right: G.inset,
    top: G.labelTop,
    height: G.labelH,
    textAlign: 'right',
  },
  reason: { ...Type.caption1, position: 'absolute', left: G.inset, right: G.inset, top: G.labelTop, height: G.labelH },
  srButton: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  srBar: { position: 'absolute', left: G.inset, right: G.inset, top: G.srTop, height: G.srH, flexDirection: 'row', gap: 6 },
  srOk: { flexBasis: '66%', flexGrow: 0, borderRadius: G.srH / 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  srNo: { flex: 1, borderRadius: G.srH / 2, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  srText: { ...Type.footnoteEmphasized },
});

export default SignatureLine;
