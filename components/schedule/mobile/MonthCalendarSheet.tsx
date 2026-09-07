import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import type { ScheduleTask } from '@/types';
import { parseCalendarDay, addCalendarDays } from '@/utils/calendarDate';
import { addWorkingDays } from '@/utils/scheduleEngine';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function sameDay(a: Date, b: Date): boolean { return startOfDay(a).getTime() === startOfDay(b).getTime(); }

interface Props {
  visible: boolean;
  selectedDate: Date;
  tasks: ScheduleTask[];
  startDateIso: string;
  /** Schedule calendar — see MobileScheduleList. */
  workingDaysPerWeek?: number;
  nonWorkingDates?: string[];
  onSelect: (d: Date) => void;
  onClose: () => void;
}

export function MonthCalendarSheet({ visible, selectedDate, tasks, startDateIso, workingDaysPerWeek, nonWorkingDates, onSelect, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [cursor, setCursor] = useState<Date>(startOfDay(selectedDate));

  const activeDayKeys = useMemo(() => {
    // UX-F2: startDateIso is a bare 'YYYY-MM-DD' — resolve it as a LOCAL
    // calendar day, or every active-day key sat one day early west of
    // Greenwich (Sunday highlighted for a Monday start).
    const base = parseCalendarDay(startDateIso) ?? startOfDay(new Date());
    const wdpw = workingDaysPerWeek ?? 5;
    const keys = new Set<string>();
    for (const t of tasks) {
      if (t.isSummary) continue;
      // B4 review A9 / item 2: startDay is a WORKING-day number (day 1 = the
      // anchor), so a task's active days are walked with addWorkingDays —
      // the same resolver as the desktop grid — not `base.getTime() + d *
      // MS_DAY`, which dotted the Saturday for a startDay-6 task and, once
      // the walk crossed the 2026-11-01 fall-back, dotted every later day
      // one day early (a 25-hour day floors to 23:00 of the day before).
      let day = addWorkingDays(base, (t.startDay ?? 1) - 1, wdpw, nonWorkingDates);
      const n = Math.max(1, t.durationDays || 1);
      for (let k = 0; k < n; k++) {
        keys.add(`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`);
        day = addWorkingDays(day, 1, wdpw, nonWorkingDates);
      }
    }
    return keys;
  }, [tasks, startDateIso, workingDaysPerWeek, nonWorkingDates]);

  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startOffset = first.getDay();
    // Component arithmetic, not `getTime() ± i * MS_DAY`: November 2026 opens
    // ON the US fall-back (Sunday the 1st), and the millisecond walk rendered
    // that month as "1, 1, 2, 3, …" in Denver.
    return Array.from({ length: 42 }, (_, i) => addCalendarDays(first, i - startOffset));
  }, [cursor]);

  const today = startOfDay(new Date());
  const shiftMonth = (delta: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
  const pick = (d: Date) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    onSelect(startOfDay(d));
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.grab} />
        <View style={styles.head}>
          <TouchableOpacity onPress={() => shiftMonth(-1)} style={styles.nav} accessibilityLabel="Previous month"><ChevronLeft size={20} color={colors.text} strokeWidth={1.75} /></TouchableOpacity>
          <Text style={styles.title}>{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</Text>
          <TouchableOpacity onPress={() => shiftMonth(1)} style={styles.nav} accessibilityLabel="Next month"><ChevronRight size={20} color={colors.text} strokeWidth={1.75} /></TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.nav} accessibilityLabel="Close"><X size={18} color={colors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
        </View>
        <View style={styles.dowRow}>
          {DOW.map((d, i) => <Text key={i} style={styles.dow}>{d}</Text>)}
        </View>
        <View style={styles.gridWrap}>
          {grid.map((d, i) => {
            const inMonth = d.getMonth() === cursor.getMonth();
            const isSel = sameDay(d, selectedDate);
            const isToday = sameDay(d, today);
            const hasWork = activeDayKeys.has(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
            return (
              <TouchableOpacity key={i} style={styles.cell} activeOpacity={0.7} onPress={() => pick(d)} testID={`cal-day-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`}>
                <View style={[styles.dayWrap, isSel && { backgroundColor: colors.accent }]}>
                  <Text style={[styles.day, !inMonth && styles.dayDim, isSel && { color: '#FFFFFF' }, !isSel && isToday && { color: colors.accent, fontWeight: '800' }]}>{d.getDate()}</Text>
                </View>
                <View style={[styles.dot, hasWork && !isSel ? { backgroundColor: colors.accent } : null]} />
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity style={styles.todayBtn} onPress={() => pick(new Date())} testID="cal-today">
          <Text style={styles.todayBtnText}>Jump to Today</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { position: 'absolute' as const, left: 0, right: 0, bottom: 0, backgroundColor: t.bg, borderTopLeftRadius: Tokens.radius.xl, borderTopRightRadius: Tokens.radius.xl, padding: 16 },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center' as const, marginBottom: 12 },
  head: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 10 },
  title: { flex: 1, fontSize: 17, fontWeight: '800' as const, color: t.text },
  nav: { width: 34, height: 34, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: 17, backgroundColor: t.surfaceAlt },
  dowRow: { flexDirection: 'row' as const },
  dow: { flex: 1, textAlign: 'center' as const, fontSize: 11, fontWeight: '700' as const, color: t.textMuted, paddingVertical: 4 },
  gridWrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const },
  cell: { width: `${100 / 7}%`, alignItems: 'center' as const, paddingVertical: 4 },
  dayWrap: { width: 36, height: 36, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const },
  day: { fontSize: 15, fontWeight: '600' as const, color: t.text },
  dayDim: { color: t.textMuted, opacity: 0.45 },
  dot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 2, backgroundColor: 'transparent' },
  todayBtn: { marginTop: 12, alignSelf: 'center' as const, paddingVertical: 10, paddingHorizontal: 22, borderRadius: Tokens.radius.md, backgroundColor: t.surfaceAlt },
  todayBtnText: { fontSize: 14, fontWeight: '700' as const, color: t.accent },
});
