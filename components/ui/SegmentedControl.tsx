// SegmentedControl — sub-tabs and view switchers.
//
// WHY. Every segmented row in the app is hand-rolled as `flexDirection:'row'`
// with `flex: 1` segments. On a phone that is right. On a 1512 px MacBook the
// punch-list "Punch | Crew list" switch measured 881 px PER SEGMENT, and the
// founder's words were "the boxes are so stretched out and it looks terrible".
// A switcher is a control, not a banner: on desktop it sits top-left under the
// page title at its own intrinsic width.
//
// Two exports:
//   - <SegmentedControl options value onChange size variant> for new code;
//   - `segmentedDesktop` layout objects for the ~25 existing hand-rolled rows,
//     appended behind the gate so the phone is untouched:
//
//       <View style={[styles.listSwitch, isDesktop && segmentedDesktop.container]}>
//         <Pressable style={[styles.listSwitchSeg, isDesktop && segmentedDesktop.segment]} …>
//
//     (numeric quick-picks — 0/25/50/75/100, FS/SS/FF/SF, date pills — use
//     `segmentedDesktop.numericSegment`, a fixed 56.)
//
// Reference implementations already built this way: estimate/full's
// desktopTabRow (maxWidth 560) and GanttTab's layoutBar (alignSelf flex-start).

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Layout, Motion, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { cardSurface } from './Card';
import { nativeDriver, reducedMotion } from './motion';
import {
  resolveSegmentedVariant,
  segmentBox,
  SEGMENTED_GAP,
  SEGMENTED_PAD,
  useIsDesktop,
  type SegmentedVariant,
} from './desktop';

/**
 * Layout-only desktop objects. flexGrow / flexShrink / flexBasis are longhands
 * on purpose: they override a hand-rolled segment's own `flex: 1` shorthand.
 */
export const segmentedDesktop: {
  container: ViewStyle;
  segment: ViewStyle;
  numericSegment: ViewStyle;
  underlineContainer: ViewStyle;
  underlineSegment: ViewStyle;
} = {
  container: {
    alignSelf: 'flex-start',
    flexGrow: 0,
    maxWidth: Layout.segment.controlMax,
    padding: SEGMENTED_PAD,
    gap: SEGMENTED_GAP,
  },
  segment: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    ...segmentBox('text'),
    height: Layout.segment.height,
    minHeight: Layout.segment.height,
    paddingVertical: 0,
    paddingHorizontal: 14,
    // Icon LEFT of a one-line label (construction-ai stacked them).
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  numericSegment: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    ...segmentBox('numeric'),
    minWidth: 0,
    height: Layout.segment.height,
    minHeight: Layout.segment.height,
    paddingVertical: 0,
    paddingHorizontal: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // More than 6 options: the same row as underline tabs — no pill fill, a 2 px
  // accent underline on the active tab, still intrinsic width. It wraps rather
  // than overflow a narrow column.
  underlineContainer: {
    alignSelf: 'flex-start',
    flexGrow: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    maxWidth: '100%',
    padding: 0,
    gap: 4,
    backgroundColor: 'transparent',
  },
  underlineSegment: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    height: Layout.segment.height + 4,
    paddingHorizontal: 12,
    paddingVertical: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 0,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    backgroundColor: 'transparent',
  },
};

type IconLike = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
  /** A lucide icon component (not an element) — sized and coloured here. */
  icon?: IconLike;
  /** Optional count badge ("Open 3"). */
  count?: number;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** sm = 32 pt phone segments, md = 40 pt (default). Desktop is always 32. */
  size?: 'sm' | 'md';
  /** 'auto' (default): pills up to 6 options, underline tabs past that.
   *  'numeric': fixed-width quick-picks (0/25/50/75/100). */
  variant?: SegmentedVariant;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

/** A segment's box, from its onLayout, relative to the row (or the phone
 *  ScrollView's content container) the indicator is absolutely placed in. */
export type SegRect = { x: number; y: number; w: number; h: number };

type SpringConfig = { damping: number; stiffness: number; mass: number };

export interface SegmentGlide {
  from: SegRect;
  to: SegRect;
  movingRight: boolean;
  /** The spring for each EDGE. The edge on the side of travel is the lead:
   *  stiff and near-critical, so it runs ahead; the other edge trails on a
   *  softer spring and catches up. That gap is the stretch, and it settles
   *  back to the target's exact width. */
  leftSpring: SpringConfig;
  rightSpring: SpringConfig;
}

/**
 * The selection indicator's plan for a value change, or null when the change
 * should stay today's instant swap: Reduce Motion is on, either segment has not
 * been measured (or measured zero), or the two sit on different lines (a
 * wrapped desktop underline row gets no cross-line travel).
 */
export function planSegmentGlide(
  from: SegRect | undefined,
  to: SegRect | undefined,
  reduced: boolean,
): SegmentGlide | null {
  if (reduced || !from || !to) return null;
  if (!(from.w > 0 && from.h > 0 && to.w > 0 && to.h > 0)) return null;
  if (from.y !== to.y) return null;
  const movingRight = to.x > from.x;
  return { from, to, movingRight, ...edgeSprings(movingRight) };
}

/** Moving right, the right edge leads and the left trails; moving left, the
 *  reverse. */
export function edgeSprings(movingRight: boolean): { leftSpring: SpringConfig; rightSpring: SpringConfig } {
  return movingRight
    ? { leftSpring: Motion.spring.glideTrail, rightSpring: Motion.spring.glideLead }
    : { leftSpring: Motion.spring.glideLead, rightSpring: Motion.spring.glideTrail };
}

/** Did a segment's box move? (A desktop segment is intrinsic width, so the
 *  target's label turning bold can re-measure it mid-glide.) */
export function sameRect(a: SegRect, b: SegRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  size = 'md',
  variant = 'auto',
  style,
  accessibilityLabel,
  testID,
}: SegmentedControlProps<T>) {
  const isDesktop = useIsDesktop();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const look = resolveSegmentedVariant(options.length, variant);
  const underline = look === 'underline';
  const numeric = look === 'numeric';

  // ── The gliding indicator ────────────────────────────────────────────────
  // At rest there is none: the selected segment paints its own fill (segOn) or
  // underline, exactly as before. On a value change ONE indicator mounts at the
  // old segment and runs its two edges to the new one on separate springs (the
  // leading edge ahead of the trailing one), then unmounts on the frame the
  // target paints its own identical fill. L and R are the edges' x.
  const rects = useRef<Record<string, SegRect>>({});
  const L = useRef(new Animated.Value(0)).current;
  const R = useRef(new Animated.Value(0)).current;
  const [glide, setGlide] = useState<null | { w0: number; to: SegRect }>(null);
  const prevValue = useRef(value);
  // The glide in flight (its target and direction), or null at rest.
  const flight = useRef<{ to: SegRect; movingRight: boolean } | null>(null);

  const launch = (to: SegRect, movingRight: boolean) => {
    const springs = edgeSprings(movingRight);
    flight.current = { to, movingRight };
    setGlide({ w0: to.w, to });
    Animated.parallel([
      Animated.spring(L, { toValue: to.x, ...springs.leftSpring, useNativeDriver: nativeDriver }),
      Animated.spring(R, { toValue: to.x + to.w, ...springs.rightSpring, useNativeDriver: nativeDriver }),
    ]).start(({ finished }) => {
      if (!finished) return; // superseded by a newer glide, which clears it
      flight.current = null;
      setGlide(null);
    });
  };

  // A layout effect, so the frame that would paint the target's own fill is
  // replaced by the indicator before anything reaches the screen.
  useLayoutEffect(() => {
    const prev = prevValue.current;
    prevValue.current = value;
    if (prev === value) return; // first mount, or a re-render with no change
    const plan = planSegmentGlide(rects.current[prev], rects.current[value], reducedMotion());
    if (!plan) {
      if (flight.current) {
        flight.current = null;
        L.stopAnimation();
        R.stopAnimation();
        setGlide(null);
      }
      return;
    }
    if (flight.current) {
      // Mid-flight: carry on from wherever the edges are now.
      L.stopAnimation();
      R.stopAnimation();
    } else {
      L.setValue(plan.from.x);
      R.setValue(plan.from.x + plan.from.w);
    }
    launch(plan.to, plan.movingRight);
    // `launch` only closes over refs and a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, L, R]);

  useEffect(() => () => {
    L.stopAnimation();
    R.stopAnimation();
  }, [L, R]);

  const measure = (key: string) => (e: LayoutChangeEvent) => {
    const { x, y, width, height } = e.nativeEvent.layout;
    const r: SegRect = { x, y, w: width, h: height };
    rects.current[key] = r;
    // The target re-measured mid-glide (its label turned bold, a count
    // changed): aim at where it is now, so the hand-off has no jump.
    const f = flight.current;
    if (f && key === prevValue.current && !sameRect(f.to, r) && r.w > 0 && r.h > 0 && r.y === f.to.y) {
      launch(r, f.movingRight);
    }
  };

  // The box is [L, R]: centre it at (L + R) / 2 and scale a w0-wide view to
  // R - L. At rest R - L === w0, so scaleX is exactly 1 and the radius exact;
  // the stretch only distorts mid-flight. All four are native-driver nodes.
  const glideW0 = glide?.w0 ?? 0;
  const glideTransform = useMemo(
    () => (glideW0 > 0
      ? [
          { translateX: Animated.subtract(Animated.multiply(Animated.add(L, R), 0.5), glideW0 / 2) },
          { scaleX: Animated.divide(Animated.subtract(R, L), glideW0) },
        ]
      : null),
    [L, R, glideW0],
  );

  const indicator = glide && glideTransform ? (
    <Animated.View
      key="glide-indicator"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        underline ? styles.indicatorBar : styles.indicatorPill,
        {
          position: 'absolute',
          left: 0,
          width: glide.w0,
          // The bar sits on the target segment's own bottom edge, not the
          // container's: a wrapped desktop underline row has two lines.
          top: underline ? glide.to.y + glide.to.h - 2 : glide.to.y,
          height: underline ? 2 : glide.to.h,
          transform: glideTransform,
        },
      ]}
    />
  ) : null;


  const press = (next: T) => {
    if (next === value) return;
    if (Platform.OS === 'ios') Haptics.selectionAsync().catch(() => {});
    onChange(next);
  };

  const segments = options.map((opt) => {
    const on = opt.value === value;
    const Icon = opt.icon;
    const tint = on ? (underline ? colors.accentLabel : colors.text) : colors.textSecondary;
    return (
      <Pressable
        key={opt.value}
        onPress={() => press(opt.value)}
        onLayout={measure(opt.value)}
        disabled={opt.disabled}
        accessibilityRole="tab"
        accessibilityState={{ selected: on, disabled: !!opt.disabled }}
        accessibilityLabel={opt.accessibilityLabel ?? (opt.count !== undefined ? `${opt.label}, ${opt.count}` : opt.label)}
        testID={opt.testID ?? (testID ? `${testID}-${opt.value}` : undefined)}
        style={[
          underline ? styles.underlineSeg : styles.seg,
          !underline && !isDesktop && (size === 'sm' ? styles.segSm : styles.segMd),
          numeric && !isDesktop && styles.segNumericPhone,
          !underline && on && !glide && styles.segOn,
          underline && on && !glide && { borderBottomColor: colors.accent },
          opt.disabled && styles.segDisabled,
          isDesktop && (underline
            ? segmentedDesktop.underlineSegment
            : numeric ? segmentedDesktop.numericSegment : segmentedDesktop.segment),
          // The underline colour must survive the desktop object's transparent reset.
          isDesktop && underline && on && !glide && { borderBottomColor: colors.accent },
        ]}
      >
        {Icon ? <Icon size={15} color={tint} strokeWidth={on ? 2.2 : 1.8} /> : null}
        <Text numberOfLines={1} style={[styles.label, on && styles.labelOn, { color: tint }]}>
          {opt.label}
        </Text>
        {opt.count !== undefined ? (
          <View style={[styles.count, on && styles.countOn]}>
            <Text style={[styles.countText, { color: tint }]}>{opt.count}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  });

  // Phone underline tabs scroll: 7+ tabs cannot share 358 pt.
  if (underline && !isDesktop) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={style}
        contentContainerStyle={styles.underlineRow}
        accessibilityRole="tablist"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      >
        {indicator}
        {segments}
      </ScrollView>
    );
  }

  return (
    <View
      style={[
        underline ? styles.underlineRow : styles.row,
        style,
        isDesktop && (underline ? segmentedDesktop.underlineContainer : segmentedDesktop.container),
      ]}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {indicator}
      {segments}
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      padding: SEGMENTED_PAD,
      gap: SEGMENTED_GAP,
      borderRadius: Tokens.radius.md,
      backgroundColor: t.surfaceAlt,
    },
    underlineRow: {
      flexDirection: 'row',
      gap: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
    },
    seg: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: 10,
      borderRadius: Tokens.radius.sm,
      ...Tokens.continuousCorners,
    },
    segSm: { minHeight: 32 },
    segMd: { minHeight: Tokens.touchTarget.min },
    segNumericPhone: { paddingHorizontal: 4 },
    segOn: {
      ...cardSurface(t, { radius: 'sm', pad: 'none', bordered: false }),
      ...Tokens.shadow.subtle,
    },
    // The gliding indicator reuses segOn's recipe exactly, so the frame it
    // unmounts on and the target's own fill are the same pixels.
    indicatorPill: {
      ...cardSurface(t, { radius: 'sm', pad: 'none', bordered: false }),
      ...Tokens.shadow.subtle,
    },
    indicatorBar: { backgroundColor: t.accent },
    segDisabled: { opacity: 0.45 },
    underlineSeg: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: Tokens.touchTarget.min,
      paddingHorizontal: 12,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    label: {
      fontSize: Type.footnote.fontSize,
      fontWeight: '600' as const,
    },
    labelOn: { fontWeight: '700' as const },
    count: {
      minWidth: 20,
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: Tokens.radius.full,
      backgroundColor: t.neutralSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    countOn: { backgroundColor: t.line },
    countText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  });

export default SegmentedControl;
