// CommitDot.tsx: what the capsule's head carries (moments wave, lane CAPSULE):
// the busy ring, the two-leg check, the "!" mark and the icon stack.
//
// Everything here is a plain View or a static SVG under an Animated.View, so
// the whole celebration runs on the native driver (transform and opacity
// only). The check is TWO rounded Views scaled from its vertex, never an SVG
// strokeDashoffset, which would draw on the JS thread.

import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { ArrowRightToLine, ChevronRight, Clock3, Flag, Lock } from 'lucide-react-native';
import { CAPSULE_RULES } from '@/utils/moments/motionSpec';
import type { CapsuleValues, CapsuleResultIcon } from '@/components/moments/core/useCommitCapsule';

const SPIN = { inputRange: [0, 1], outputRange: ['0deg', '360deg'] };

/** A 2 pt arc (270°) turning on the circle while the write runs. */
export function BusyRing(p: { opacity: Animated.Value; spin: Animated.Value; size: number; inset: number; color: string }): React.ReactElement {
  const d = p.size - 2 * p.inset;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.center,
        {
          width: d,
          height: d,
          marginLeft: -d / 2,
          marginTop: -d / 2,
          borderRadius: d / 2,
          borderWidth: CAPSULE_RULES.ringStroke,
          borderColor: p.color,
          borderRightColor: 'transparent',
          opacity: p.opacity,
          transform: [{ rotate: p.spin.interpolate(SPIN) }],
        },
      ]}
    />
  );
}

/**
 * The check: a short leg (scaleY from its top) and a long leg (scaleX from
 * its left) inside a box rotated −45°, so the two draws meet at the vertex.
 * `lift` is the 3 pt level-settle.
 */
export function TwoLegCheck(p: { short: Animated.Value; long: Animated.Value; width: number; height: number;
  color: string; lift?: Animated.Value }): React.ReactElement {
  const leg = CAPSULE_RULES.checkLeg;
  const transform: any[] = p.lift
    ? [{ translateY: p.lift }, { rotate: '-45deg' }]
    : [{ rotate: '-45deg' }];
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.center,
        {
          width: p.width,
          height: p.height,
          marginLeft: -p.width / 2,
          marginTop: -p.height / 2 - 2,
          transform,
        },
      ]}
    >
      <Animated.View
        style={{
          position: 'absolute', left: 0, top: 0, width: leg, height: p.height, borderRadius: 2,
          backgroundColor: p.color, transformOrigin: 'top', transform: [{ scaleY: p.short }],
        }}
      />
      <Animated.View
        style={{
          position: 'absolute', left: 0, bottom: 0, height: leg, width: p.width, borderRadius: 2,
          backgroundColor: p.color, transformOrigin: 'left', transform: [{ scaleX: p.long }],
        }}
      />
    </Animated.View>
  );
}

/** The failure mark: a stroke and a dot (the preview's "!"). */
export function BangMark(p: { opacity: Animated.Value; size: number; color: string }): React.ReactElement {
  return (
    <Animated.View pointerEvents="none" style={[styles.center, box(p.size), { opacity: p.opacity }]}>
      <Svg width={p.size} height={p.size} viewBox="0 0 24 24" fill="none">
        <Path d="M12 6.5v7" stroke={p.color} strokeWidth={2.3} strokeLinecap="round" />
        <Path d="M12 17.5h.01" stroke={p.color} strokeWidth={2.3} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}

function box(size: number) {
  return { width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 };
}

function Icon({ opacity, size, children }: { opacity: Animated.Value | number; size: number; children: React.ReactNode }) {
  return (
    <Animated.View pointerEvents="none" style={[styles.center, box(size), { opacity }]}>
      {children}
    </Animated.View>
  );
}

export interface CommitIconStackProps {
  values: CapsuleValues;
  D: number;
  icon: number;
  checkW: number;
  checkH: number;
  ringInset: number;
  resultIcon: CapsuleResultIcon;
  /** Disabled at rest: the Lock shows instead of the chevron (track skin). */
  lockShown: boolean;
  colors: { capOn: string; onSuccess: string; bang: string; onNeutral: string; lockMuted: string };
}

/** Every icon the head can show, stacked and cross-faded by opacity. */
export function CommitIconStack(p: CommitIconStackProps): React.ReactElement {
  const v = p.values;
  const sw = 2.3;
  const chevOpacity = p.lockShown ? 0 : v.icon.chev;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Icon opacity={chevOpacity} size={p.icon}>
        <ChevronRight size={p.icon} color={p.colors.capOn} strokeWidth={sw} />
      </Icon>
      <Icon opacity={v.icon.release} size={p.icon}>
        <ArrowRightToLine size={p.icon} color={p.colors.capOn} strokeWidth={sw} />
      </Icon>
      <Icon opacity={p.lockShown ? 1 : 0} size={p.icon}>
        <Lock size={p.icon} color={p.colors.lockMuted} strokeWidth={sw} />
      </Icon>
      <BangMark opacity={v.icon.bang} size={p.icon} color={p.colors.bang} />
      <Icon opacity={v.icon.clock} size={p.icon}>
        <Clock3 size={p.icon} color={p.colors.onNeutral} strokeWidth={sw} />
      </Icon>
      {p.resultIcon === 'lock' ? (
        <Icon opacity={v.icon.result} size={p.icon}>
          <Lock size={p.icon} color={p.colors.capOn} strokeWidth={sw} />
        </Icon>
      ) : null}
      {p.resultIcon === 'flag' ? (
        <Icon opacity={v.icon.result} size={p.icon}>
          <Flag size={p.icon} color={p.colors.capOn} strokeWidth={sw} />
        </Icon>
      ) : null}
      <BusyRing opacity={v.ring} spin={v.spin} size={p.D} inset={p.ringInset} color={p.colors.capOn} />
      {p.resultIcon === 'check' ? (
        <TwoLegCheck short={v.checkShort} long={v.checkLong} width={p.checkW} height={p.checkH}
          color={p.colors.onSuccess} lift={v.checkY} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', left: '50%', top: '50%', alignItems: 'center', justifyContent: 'center' },
});
