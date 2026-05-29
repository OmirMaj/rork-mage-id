// WeekStrip — swipeable date-carousel for the mobile schedule screen.
//
// Replaces the original fixed 7-cell row + chevron buttons with a horizontal
// snap-to-day carousel that spans ±180 days from today. Same props surface
// (`selectedDate` + `onSelectDate`) so callers don't need changes.
//
// UX notes:
//  - FlatList horizontal, snap to a single day cell (56px). Decel "fast" so
//    flicks settle on a day, not between days.
//  - On mount we scroll the selected date to roughly screen-center.
//  - The month label up top tracks whichever day is currently centered, so
//    long swipes still read which month you're in.
//  - "Today" gets a subtle outlined ring even when not selected — the eye
//    can always find "now" without scrolling back.
//  - We keep the chevron back/forward affordance but shrink it to a single
//    compact stepper that hops a week at a time, for discoverability on
//    first-touch.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, NativeScrollEvent,
  NativeSyntheticEvent, LayoutChangeEvent,
} from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

interface WeekStripProps {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  /** Kept for backwards compat — not used by the carousel. */
  weekStart?: Date;
}

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Half-year of swipe room on either side of today. 361 days total so the
// center is unambiguous and we don't fight the FlatList's virtualization.
const DAYS_BEFORE = 180;
const DAYS_AFTER  = 180;
const RANGE_LEN   = DAYS_BEFORE + DAYS_AFTER + 1;

const CELL_W = 56;
const CELL_H = 70;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function WeekStrip({ selectedDate, onSelectDate }: WeekStripProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const listRef = useRef<FlatList<Date>>(null);

  // Anchor the carousel to today's midnight, captured once on first render.
  // Re-anchoring on every selectedDate change would force the FlatList to
  // remount and lose scroll momentum.
  const anchorMs = useRef(startOfDay(new Date()).getTime()).current;

  const days = useMemo(() => {
    const start = new Date(anchorMs);
    start.setDate(start.getDate() - DAYS_BEFORE);
    return Array.from({ length: RANGE_LEN }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [anchorMs]);

  const todayMs = startOfDay(new Date()).getTime();
  const selMs   = startOfDay(selectedDate).getTime();

  // Width of the carousel viewport — measured on first layout. Used so we
  // can scroll the selected day to roughly screen-center, not just snap it
  // against the left edge.
  const [viewportW, setViewportW] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setViewportW(e.nativeEvent.layout.width);
  }, []);

  const selIdx = useMemo(() => {
    return days.findIndex((d) => startOfDay(d).getTime() === selMs);
  }, [days, selMs]);

  // Scroll-driven month label. Updated on momentum-end + every ~80ms during
  // an active scroll. Two states: the "live" centered date during a drag,
  // and the resting value when idle.
  const [centeredIdx, setCenteredIdx] = useState<number>(() => Math.max(0, selIdx));

  // Centering math, with `contentContainerStyle.paddingHorizontal =
  // (viewportW - CELL_W) / 2`:
  //   cell i's center in content coords = P + i*CELL_W + CELL_W/2
  //   viewport center in content coords = scrollOffset + viewportW/2
  // Setting equal and solving collapses the padding out:
  //   scrollOffset = i * CELL_W   (to center cell i)
  //   centeredIdx  = round(scrollOffset / CELL_W)
  // Earlier versions of this file dropped the padding term and ended up
  // ~3 cells off — the tapped day landed at the right viewport edge
  // instead of the center.
  useEffect(() => {
    if (selIdx < 0 || viewportW === 0) return;
    listRef.current?.scrollToOffset({ offset: Math.max(0, selIdx * CELL_W), animated: true });
    setCenteredIdx(selIdx);
  }, [selIdx, viewportW]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (viewportW === 0) return;
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.round(x / CELL_W);
    const clamped = Math.max(0, Math.min(days.length - 1, idx));
    if (clamped !== centeredIdx) setCenteredIdx(clamped);
  }, [viewportW, days.length, centeredIdx]);

  const shiftWeek = useCallback((delta: number) => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + delta * 7);
    onSelectDate(next);
  }, [selectedDate, onSelectDate]);

  const centered = days[centeredIdx] ?? selectedDate;
  const headerMonth = `${MONTHS[centered.getMonth()]} ${centered.getFullYear()}`;

  const renderDay = useCallback(({ item: d }: { item: Date }) => {
    const dMs = startOfDay(d).getTime();
    const isSel = dMs === selMs;
    const isToday = dMs === todayMs;
    return (
      <TouchableOpacity
        style={styles.cell}
        activeOpacity={0.7}
        onPress={() => onSelectDate(d)}
        accessibilityRole="button"
        accessibilityLabel={`${DOW[d.getDay()]} ${d.getDate()}`}
      >
        <Text style={[
          styles.dow,
          isSel ? { color: colors.accent } : null,
          !isSel && isToday ? { color: colors.accent } : null,
        ]}>
          {DOW[d.getDay()]}
        </Text>
        <View style={[
          styles.numWrap,
          isSel ? { backgroundColor: colors.accent } : null,
          !isSel && isToday ? { borderWidth: 1.5, borderColor: colors.accent } : null,
        ]}>
          <Text style={[
            styles.num,
            isSel ? { color: '#FFFFFF' } : null,
            !isSel && isToday ? { color: colors.accent } : null,
          ]}>
            {d.getDate()}
          </Text>
        </View>
        {/* Tiny accent dot for "today" so it's findable even when not
            selected and not in view of the header label. */}
        {isToday && !isSel && (
          <View style={[styles.todayDot, { backgroundColor: colors.accent }]} />
        )}
      </TouchableOpacity>
    );
  }, [selMs, todayMs, colors.accent, onSelectDate, styles]);

  const getItemLayout = useCallback((_: ArrayLike<Date> | null | undefined, index: number) => ({
    length: CELL_W,
    offset: CELL_W * index,
    index,
  }), []);

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={styles.monthLabel}>{headerMonth}</Text>
        <View style={styles.stepperRow}>
          <TouchableOpacity
            onPress={() => shiftWeek(-1)}
            style={styles.stepperBtn}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel="Previous week"
          >
            <ChevronLeft size={15} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => shiftWeek(1)}
            style={styles.stepperBtn}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel="Next week"
          >
            <ChevronRight size={15} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.listWrap} onLayout={onLayout}>
        <FlatList
          ref={listRef}
          data={days}
          keyExtractor={(d) => d.toISOString().slice(0, 10)}
          renderItem={renderDay}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={CELL_W}
          decelerationRate="fast"
          getItemLayout={getItemLayout}
          onScroll={onScroll}
          scrollEventThrottle={32}
          initialNumToRender={14}
          windowSize={5}
          contentContainerStyle={{ paddingHorizontal: Math.max(0, (viewportW - CELL_W) / 2) }}
        />
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { paddingTop: 6, paddingBottom: 4 },

  headRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  monthLabel: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: t.text,
    letterSpacing: -0.2,
  },
  stepperRow: { flexDirection: 'row' as const, gap: 4 },
  stepperBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },

  listWrap: { height: CELL_H + 8 },
  cell: {
    width: CELL_W,
    alignItems: 'center' as const,
    justifyContent: 'flex-start' as const,
    gap: 5,
    paddingTop: 4,
  },
  dow: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: t.textMuted,
    letterSpacing: 0.5,
  },
  numWrap: {
    width: 38, height: 38, borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  num: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: t.text,
  },
  todayDot: {
    width: 4, height: 4, borderRadius: 2,
    marginTop: 3,
  },
});
