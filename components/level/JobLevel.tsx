// components/level/JobLevel.tsx — the Level as a still READING of one
// project's health (ideas-1, T5). The engine is utils/jobLevel; this draws it.
//
// SAME MARK. The geometry is The Level's own (utils/levelTimeline levelParts)
// and the colours its palette rule (components/loaders/themeFallback
// levelPalette); nothing in components/loaders is changed or re-implemented.
//
//   • bubble position = reading.offset × the geometry's travel (behind = right);
//   • tint (bubble + vial) = steady → accent, watch → warningLabel,
//     risk → danger, none → textMuted;
//   • no slip reading → the bubble is HOLLOW and centred (a hollow bubble has
//     no position to report — never a solid centred "on plan");
//   • no_data → the whole vial is grey and hollow, "Not enough data yet".
//
// MOTION. It never loops and never seeks like the loader. When the reading's
// `key` changes while mounted, the bubble eases to its new place ONCE
// (Animated.timing, native driver, 450 ms, easeOutCubic). The last position
// drawn is remembered per project in a module map, so a list that remounts
// (a stage chip, a scroll) starts where it was and replays nothing. Reduce
// Motion: it jumps.
//
// TAP opens the reason (JobLevelReason, the Sheet primitive). The press stops
// the event, so a Level inside a row link or a card never also opens the row;
// on web the sheet is wrapped in a click-stopper, because React events from a
// portal still bubble to the row's link through the React tree.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, PixelRatio, Platform, Pressable, StyleSheet, Text, View,
  type GestureResponderEvent, type ViewStyle,
} from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { levelPalette } from '@/components/loaders/themeFallback';
import { easeOutCubic, levelParts, type LevelRect } from '@/utils/levelTimeline';
import {
  JOB_LEVEL_DETAIL_SIZE, JOB_LEVEL_EASE_MS, JOB_LEVEL_ROW_SIZE,
  type JobLevelReading, type JobLevelTint,
} from '@/utils/jobLevel';
import { JobLevelReason } from './JobLevelReason';

export type JobLevelSize = 'row' | 'detail';

/** projectId → the offset last drawn (a number only; no project data). */
const lastShown = new Map<string, number>();

/** Test hook: forget every remembered position. */
export function __resetJobLevelMemory(): void {
  lastShown.clear();
}

export function tintColor(tint: JobLevelTint, c: ThemeColors): string {
  switch (tint) {
    case 'steady': return c.accent;
    case 'watch': return c.warningLabel;
    case 'risk': return c.danger;
    default: return c.textMuted;
  }
}

const snap = (v: number) => PixelRatio.roundToNearestPixel(v);

function rect(r: LevelRect, bg: string, opacity?: number): ViewStyle {
  return {
    position: 'absolute',
    left: snap(r.left),
    top: snap(r.top),
    width: Math.max(1, snap(r.width)),
    height: Math.max(1, snap(r.height)),
    borderRadius: snap(r.radius),
    backgroundColor: bg,
    ...(opacity != null && opacity !== 1 ? { opacity } : null),
  };
}

export interface JobLevelVialProps {
  projectId: string;
  reading: JobLevelReading;
  size?: JobLevelSize;
  testID?: string;
}

/** The drawing alone: the vial, the caps and the bubble at its offset. */
export function JobLevelVial({ projectId, reading, size = 'row', testID }: JobLevelVialProps) {
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const width = size === 'detail' ? JOB_LEVEL_DETAIL_SIZE : JOB_LEVEL_ROW_SIZE;
  const parts = useMemo(() => levelParts(width, 'accent'), [width]);
  const empty = reading.kind === 'no_data';
  const ink = empty ? colors.textMuted : tintColor(reading.tint, colors);
  const pal = levelPalette(empty ? 'muted' : 'accent', ink, colors);
  const hollow = !reading.hasSchedule;

  const target = reading.hasSchedule ? reading.offset : 0;
  const startRef = useRef<number | null>(null);
  if (startRef.current === null) startRef.current = lastShown.get(projectId) ?? target;
  const x = useRef(new Animated.Value(startRef.current * parts.amp)).current;
  const shown = useRef(startRef.current);

  useEffect(() => {
    const from = shown.current;
    shown.current = target;
    lastShown.set(projectId, target);
    if (from === target || reduce) {
      x.setValue(target * parts.amp);
      return;
    }
    const a = Animated.timing(x, {
      toValue: target * parts.amp,
      duration: JOB_LEVEL_EASE_MS,
      easing: easeOutCubic,
      useNativeDriver: nativeDriver,
    });
    a.start();
    return () => a.stop();
    // The reading's key is the change signal; target follows from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading.key, parts.amp, reduce, projectId]);

  const bubble = rect(parts.bubble, hollow ? 'transparent' : pal.bubble);
  const bubbleStyle: ViewStyle = hollow
    ? { ...bubble, borderWidth: snap(1.5), borderColor: pal.bubble }
    : bubble;

  return (
    <View
      testID={testID}
      style={{ width: snap(parts.boxW), height: snap(parts.boxH) }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      {parts.capL && <View style={rect(parts.capL, pal.cap, parts.capOpacity)} />}
      {parts.capR && <View style={rect(parts.capR, pal.cap, parts.capOpacity)} />}
      <View style={rect(parts.track, ink, parts.trackOpacity)} />
      {parts.grads?.map((g, i) => <View key={i} style={rect(g, pal.grad, parts.gradOpacity)} />)}
      <Animated.View
        testID={testID ? `${testID}-bubble` : undefined}
        style={[bubbleStyle, { transform: [{ translateX: x }] }]}
      />
    </View>
  );
}

export interface JobLevelProps {
  projectId: string;
  reading: JobLevelReading;
  size?: JobLevelSize;
  /** Draw the one-line label beside the vial. Default: at detail size, and
   *  always for no data ("Not enough data yet" is said, not only drawn). A
   *  host with no room (the table's 64 px column) passes false. */
  showLabel?: boolean;
  /** The sheet's subtitle. */
  projectName?: string;
  testID?: string;
}

// On web a click inside the sheet's portal still bubbles, through the React
// tree, to the row link / card the Level sits in. This stops it at the Level.
const WEB_CLICK_STOP: object | null = Platform.OS === 'web'
  ? { onClick: (e: { stopPropagation?: () => void }) => e.stopPropagation?.() }
  : null;

export function JobLevel({ projectId, reading, size = 'row', showLabel, projectName, testID }: JobLevelProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const id = testID ?? `joblevel-${projectId}`;
  const withLabel = showLabel ?? (size === 'detail' || reading.kind === 'no_data');

  const onPress = (e: GestureResponderEvent) => {
    // Inside a row link (an <a> on web) or a card: this press is the Level's.
    const ev = e as unknown as { preventDefault?: () => void; stopPropagation?: () => void } | undefined;
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    setOpen(true);
  };

  return (
    <>
      <Pressable
        onPress={onPress}
        hitSlop={8}
        style={[styles.wrap, size === 'detail' && styles.wrapDetail]}
        accessibilityRole="button"
        accessibilityLabel={reading.accessibilityLabel}
        accessibilityHint="Shows the reasons"
        testID={id}
      >
        <JobLevelVial projectId={projectId} reading={reading} size={size} testID={`${id}-vial`} />
        {withLabel ? (
          <Text
            style={[size === 'detail' ? Type.footnote : Type.caption2, { color: reading.kind === 'no_data' ? colors.textMuted : colors.textSecondary }]}
            numberOfLines={1}
            testID={`${id}-label`}
          >
            {reading.label}
          </Text>
        ) : null}
      </Pressable>
      {open ? (
        <View {...WEB_CLICK_STOP} style={styles.portalHost}>
          <JobLevelReason visible onClose={() => setOpen(false)} reading={reading} projectName={projectName}>
            <JobLevelVial projectId={projectId} reading={reading} size="detail" />
          </JobLevelReason>
        </View>
      ) : null}
    </>
  );
}

export default JobLevel;

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 20 },
  wrapDetail: { flexDirection: 'column', gap: 8 },
  portalHost: { position: 'absolute', width: 0, height: 0 },
});
