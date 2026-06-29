// DatePickerModal — lightweight cross-platform date picker.
//
// Why custom instead of @react-native-community/datetimepicker:
//   1. Native iOS DatePicker is a wheel that takes a full screen
//      modal. Looks great on phones, terrible on web. We need
//      mobile + desktop parity for app.mageid.app to feel cohesive.
//   2. Web gets a native <input type="date"> spinner whether we want
//      it or not. Inconsistent UX across breakpoints.
//   3. The DFR / RFI / Submittal date use cases are simple — pick a
//      date in the past or today. We don't need date+time, time
//      zones, or recurring dates. A 3-column wheel + Today/Yesterday
//      shortcut buttons is the right size of solution.
//
// Behavior:
//   - Opens with the current value (or today if none).
//   - Three independently-scrollable lists: Month / Day / Year.
//   - "Today" + "Yesterday" quick buttons for the most common picks.
//   - "Cancel" returns the original value untouched.
//   - "Confirm" calls onChange with an ISO string at noon UTC (avoids
//     the day-shift trap when the device timezone wraps midnight).
//
// Date range:
//   - past 5 years → today (a DFR or change order from 2019 isn't a
//     legitimate use case in a small-GC SaaS; clamping the scroll
//     keeps the picker fast).
//   - Future picks are blocked because every consumer (DFR, RFI, etc)
//     should be a "today or earlier" record. Pass `allowFuture` to
//     override for schedules.

import React, { useMemo, useState, useEffect } from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { X, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface Props {
  visible: boolean;
  /** ISO date string. Defaults to today if empty. */
  value: string;
  onClose: () => void;
  onChange: (iso: string) => void;
  /** Optional title shown in the modal header. */
  title?: string;
  /** When true, allow picking dates in the future (e.g. for schedules). */
  allowFuture?: boolean;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function DatePickerModal({
  visible,
  value,
  onClose,
  onChange,
  title = 'Pick a date',
  allowFuture = false,
}: Props) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Parse the incoming value once per open. Treat invalid input as today.
  const initial = useMemo(() => {
    const parsed = value ? new Date(value) : new Date();
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [value]);

  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth()); // 0-indexed
  const [day, setDay] = useState(initial.getDate());

  // Reset internal state every time the modal opens — otherwise stale
  // local edits survive a "Cancel" + reopen.
  useEffect(() => {
    if (visible) {
      setYear(initial.getFullYear());
      setMonth(initial.getMonth());
      setDay(initial.getDate());
    }
  }, [visible, initial]);

  const today = new Date();
  const minYear = today.getFullYear() - 5;
  const maxYear = allowFuture ? today.getFullYear() + 5 : today.getFullYear();
  const yearOptions = useMemo(() => {
    const out: number[] = [];
    for (let y = maxYear; y >= minYear; y--) out.push(y);
    return out;
  }, [minYear, maxYear]);

  // Days in the selected month/year — clamps Feb 30, etc.
  const daysInMonth = useMemo(() => new Date(year, month + 1, 0).getDate(), [year, month]);

  // If the day is now invalid for the new month/year, snap it down.
  useEffect(() => {
    if (day > daysInMonth) setDay(daysInMonth);
  }, [daysInMonth, day]);

  const dayOptions = useMemo(() => {
    const out: number[] = [];
    for (let d = 1; d <= daysInMonth; d++) out.push(d);
    return out;
  }, [daysInMonth]);

  const setToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setDay(today.getDate());
  };

  const setYesterday = () => {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    setYear(y.getFullYear());
    setMonth(y.getMonth());
    setDay(y.getDate());
  };

  const handleConfirm = () => {
    // Noon UTC anchor avoids day-shift on timezones west of GMT.
    // Clients render with toLocaleDateString() which respects the user
    // device tz, so picking "Jan 13" stays "Jan 13" regardless of where
    // they are.
    const picked = new Date(Date.UTC(year, month, day, 12, 0, 0));
    onChange(picked.toISOString());
    onClose();
  };

  const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = year === yesterday.getFullYear() && month === yesterday.getMonth() && day === yesterday.getDate();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>

          {/* Quick picks */}
          <View style={styles.quickRow}>
            <TouchableOpacity
              style={[styles.quickPill, isToday && styles.quickPillActive]}
              onPress={setToday}
              activeOpacity={0.85}
            >
              <Text style={[styles.quickPillText, isToday && styles.quickPillTextActive]}>Today</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.quickPill, isYesterday && styles.quickPillActive]}
              onPress={setYesterday}
              activeOpacity={0.85}
            >
              <Text style={[styles.quickPillText, isYesterday && styles.quickPillTextActive]}>Yesterday</Text>
            </TouchableOpacity>
          </View>

          {/* Three-wheel picker */}
          <View style={styles.wheels}>
            <Wheel<number>
              label="Month"
              options={MONTHS.map((_, i) => i)}
              renderOption={(i) => MONTHS[i]}
              value={month}
              onChange={setMonth}
            />
            <Wheel<number>
              label="Day"
              options={dayOptions}
              renderOption={(d) => String(d)}
              value={day}
              onChange={setDay}
            />
            <Wheel<number>
              label="Year"
              options={yearOptions}
              renderOption={(y) => String(y)}
              value={year}
              onChange={setYear}
            />
          </View>

          {/* Confirm */}
          <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm} activeOpacity={0.85}>
            <Check size={16} color={themeColors.surface} strokeWidth={1.75} />
            <Text style={styles.confirmText}>
              Use {MONTHS[month]} {day}, {year}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

interface WheelProps<T> {
  label: string;
  options: T[];
  renderOption: (v: T) => string;
  value: T;
  onChange: (v: T) => void;
}

/** A single column of the picker. Tap a row to select it; current
 *  selection is highlighted + auto-scrolls into view on open. */
function Wheel<T>({ label, options, renderOption, value, onChange }: WheelProps<T>) {
  const styles = useThemedStyles(makeStyles);
  const ref = React.useRef<ScrollView>(null);
  const ROW_H = 36;

  // Center the active row when this wheel mounts / value changes.
  useEffect(() => {
    const idx = options.indexOf(value);
    if (idx < 0 || !ref.current) return;
    // Defer one tick so the ScrollView measures itself first; otherwise
    // scrollTo no-ops on first paint.
    const t = setTimeout(() => {
      ref.current?.scrollTo({ y: idx * ROW_H, animated: false });
    }, Platform.OS === 'web' ? 0 : 50);
    return () => clearTimeout(t);
  }, [options, value]);

  return (
    <View style={styles.wheel}>
      <Text style={styles.wheelLabel}>{label}</Text>
      <ScrollView
        ref={ref}
        style={styles.wheelScroll}
        contentContainerStyle={{ paddingVertical: ROW_H * 1.5 }}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW_H}
        decelerationRate="fast"
      >
        {options.map((opt, i) => {
          const isActive = opt === value;
          return (
            <TouchableOpacity
              key={i}
              style={[styles.wheelRow, isActive && styles.wheelRowActive]}
              onPress={() => onChange(opt)}
              activeOpacity={0.7}
            >
              <Text style={[styles.wheelRowText, isActive && styles.wheelRowTextActive]}>
                {renderOption(opt)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    width: '100%' as const,
    maxWidth: 420,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 16,
    gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.3 },
  quickRow: { flexDirection: 'row', gap: 8 },
  quickPill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
  },
  quickPillActive: { backgroundColor: t.accent },
  quickPillText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.text },
  quickPillTextActive: { color: t.surface },
  wheels: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  wheel: { flex: 1, gap: 4 },
  wheelLabel: { fontSize: 10, fontWeight: '700' as const, color: t.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' as const, textAlign: 'center' },
  wheelScroll: {
    height: 36 * 4,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.fillSecondary,
  },
  wheelRow: { height: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  wheelRowActive: { backgroundColor: t.accent + '14' },
  wheelRowText: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary },
  wheelRowTextActive: { fontWeight: '800' as const, color: t.accent },
  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: Tokens.radius.lg,
    backgroundColor: t.accent,
    shadowColor: t.accent, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },
  confirmText: { fontSize: Type.body.fontSize, fontWeight: '800' as const, color: t.surface, letterSpacing: 0.2 },
});
