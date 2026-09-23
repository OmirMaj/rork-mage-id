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

import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { cardSurface } from './Card';
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
        disabled={opt.disabled}
        accessibilityRole="tab"
        accessibilityState={{ selected: on, disabled: !!opt.disabled }}
        accessibilityLabel={opt.accessibilityLabel ?? (opt.count !== undefined ? `${opt.label}, ${opt.count}` : opt.label)}
        testID={opt.testID ?? (testID ? `${testID}-${opt.value}` : undefined)}
        style={[
          underline ? styles.underlineSeg : styles.seg,
          !underline && !isDesktop && (size === 'sm' ? styles.segSm : styles.segMd),
          numeric && !isDesktop && styles.segNumericPhone,
          !underline && on && styles.segOn,
          underline && on && { borderBottomColor: colors.accent },
          opt.disabled && styles.segDisabled,
          isDesktop && (underline
            ? segmentedDesktop.underlineSegment
            : numeric ? segmentedDesktop.numericSegment : segmentedDesktop.segment),
          // The underline colour must survive the desktop object's transparent reset.
          isDesktop && underline && on && { borderBottomColor: colors.accent },
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
