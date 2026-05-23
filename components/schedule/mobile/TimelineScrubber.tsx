import React, { useEffect, useRef } from 'react';
import { View, Text, PanResponder, StyleSheet, Platform, type GestureResponderEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

const MS_DAY = 86400000;

interface TimelineScrubberProps {
  baseMs: number;            // schedule start (ms, midnight)
  totalDays: number;         // project span in days
  dayIndex: number;          // current scrubbed day
  todayIndex: number;        // days from base to today
  onChange: (day: number) => void;
}

function fmt(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function TimelineScrubber({ baseMs, totalDays, dayIndex, todayIndex, onChange }: TimelineScrubberProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const widthRef = useRef(0);
  const x0Ref = useRef(0);
  const lastRef = useRef(dayIndex);
  const trackRef = useRef<View>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => { lastRef.current = dayIndex; }, [dayIndex]);

  const setFromPageX = useRef((pageX: number) => {
    const w = widthRef.current;
    if (w <= 0 || totalDays <= 0) return;
    let d = Math.round(((pageX - x0Ref.current) / w) * totalDays);
    d = Math.max(0, Math.min(totalDays, d));
    if (d !== lastRef.current) {
      lastRef.current = d;
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
      onChangeRef.current(d);
    }
  });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        const pageX = e.nativeEvent.pageX;
        trackRef.current?.measureInWindow((x, _y, w) => { x0Ref.current = x; widthRef.current = w; setFromPageX.current(pageX); });
      },
      onPanResponderMove: (e: GestureResponderEvent) => setFromPageX.current(e.nativeEvent.pageX),
    }),
  ).current;

  const pct = totalDays > 0 ? Math.max(0, Math.min(1, dayIndex / totalDays)) : 0;
  const todayPct = totalDays > 0 ? Math.max(0, Math.min(1, todayIndex / totalDays)) : 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.dateRow}>
        <Text style={styles.date}>{fmt(baseMs + dayIndex * MS_DAY)}</Text>
        <Text style={styles.hint}>drag to see it build</Text>
      </View>
      <View
        ref={trackRef}
        onLayout={() => trackRef.current?.measureInWindow((x, _y, w) => { x0Ref.current = x; widthRef.current = w; })}
        hitSlop={{ top: 14, bottom: 14, left: 4, right: 4 }}
        style={styles.hit}
        {...pan.panHandlers}
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: colors.accent }]} />
          {todayIndex >= 0 && todayIndex <= totalDays && (
            <View style={[styles.todayTick, { left: `${todayPct * 100}%`, backgroundColor: colors.text }]} />
          )}
          <View style={[styles.thumb, { left: `${pct * 100}%`, borderColor: colors.accent }]} />
        </View>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8 },
  dateRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginBottom: 4 },
  date: { fontSize: 14, fontWeight: '800' as const, color: t.text },
  hint: { fontSize: 11, fontWeight: '600' as const, color: t.textMuted },
  hit: { paddingVertical: 10, justifyContent: 'center' as const },
  track: { height: 8, borderRadius: 4, backgroundColor: t.line, justifyContent: 'center' as const },
  fill: { height: 8, borderRadius: 4 },
  todayTick: { position: 'absolute' as const, width: 2, height: 16, top: -4, marginLeft: -1, opacity: 0.5 },
  thumb: { position: 'absolute' as const, width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF', borderWidth: 3, marginLeft: -10 },
});
