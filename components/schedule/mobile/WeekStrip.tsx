import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

interface WeekStripProps {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  /** First day of the week to show. Defaults to the Sunday of selectedDate. */
  weekStart?: Date;
}

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function WeekStrip({ selectedDate, onSelectDate, weekStart }: WeekStripProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const todayMs = startOfDay(new Date()).getTime();
  const selMs = startOfDay(selectedDate).getTime();

  const days = useMemo(() => {
    const base = weekStart
      ? startOfDay(weekStart)
      : (() => {
          const s = startOfDay(selectedDate);
          s.setDate(s.getDate() - s.getDay());
          return s;
        })();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d;
    });
  }, [weekStart, selectedDate]);

  const shiftWeek = (delta: number) => {
    const d = startOfDay(selectedDate);
    d.setDate(d.getDate() + delta * 7);
    onSelectDate(d);
  };

  return (
    <View style={styles.wrap}>
      <TouchableOpacity onPress={() => shiftWeek(-1)} style={styles.navBtn} activeOpacity={0.6} accessibilityRole="button" accessibilityLabel="Previous week">
        <ChevronLeft size={18} color={colors.textMuted} />
      </TouchableOpacity>
      <Text style={styles.month}>{MONTHS[days[0].getMonth()]}</Text>
      <View style={styles.row}>
        {days.map((d, i) => {
          const dMs = startOfDay(d).getTime();
          const isSel = dMs === selMs;
          const isToday = dMs === todayMs;
          return (
            <TouchableOpacity
              key={i}
              style={styles.cell}
              activeOpacity={0.7}
              onPress={() => onSelectDate(d)}
              accessibilityRole="button"
              accessibilityLabel={`${DOW[d.getDay()]} ${d.getDate()}`}
            >
              <Text style={[styles.dow, isSel ? { color: colors.accent } : null]}>{DOW[d.getDay()]}</Text>
              <View style={[styles.numWrap, isSel ? { backgroundColor: colors.accent } : null]}>
                <Text
                  style={[
                    styles.num,
                    isSel ? { color: '#FFFFFF' } : null,
                    !isSel && isToday ? { color: colors.accent } : null,
                  ]}
                >
                  {d.getDate()}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      <TouchableOpacity onPress={() => shiftWeek(1)} style={styles.navBtn} activeOpacity={0.6} accessibilityRole="button" accessibilityLabel="Next week">
        <ChevronRight size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 8, paddingVertical: 8, gap: 4 },
  navBtn: { width: 22, height: 38, alignItems: 'center' as const, justifyContent: 'center' as const },
  month: { fontSize: 11, fontWeight: '800' as const, color: t.textMuted, width: 24, letterSpacing: 0.5 },
  row: { flexDirection: 'row' as const, flex: 1, justifyContent: 'space-between' as const },
  cell: { alignItems: 'center' as const, gap: 5, flex: 1 },
  dow: { fontSize: 10, fontWeight: '700' as const, color: t.textMuted, letterSpacing: 0.3 },
  numWrap: { width: 34, height: 38, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const },
  num: { fontSize: 15, fontWeight: '700' as const, color: t.text },
});
