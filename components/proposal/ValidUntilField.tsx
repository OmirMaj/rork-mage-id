// components/proposal/ValidUntilField.tsx — the "Prices valid until" row on a
// proposal or a quick quote (roadmap T2).
//
// A fixed date HE picks: the screen seeds it with defaultValidUntil(today)
// (today + 30 days) and saves whatever this row reports. Change opens the
// app's own DatePickerModal (future dates allowed). The picker hands back a
// noon-UTC instant built from the picked year/month/day, so its first ten
// characters are exactly the calendar day he picked.
//
// Presentation only — no storage. The value it reports is a 'YYYY-MM-DD'.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import DatePickerModal from '@/components/DatePickerModal';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { formatCalendarDay, todayCalendarDay } from '@/utils/calendarDate';
import { defaultValidUntil, isCalendarDay, isExpired } from '@/utils/proposalValidity';

export interface ValidUntilFieldProps {
  /** The saved calendar day. Blank or malformed shows the 30-day default. */
  value: string | null | undefined;
  onChange: (day: string) => void;
  /** Today's calendar day; defaults to the device's. */
  today?: string;
}

export function ValidUntilField({ value, onChange, today }: ValidUntilFieldProps) {
  const styles = useThemedStyles(makeStyles);
  const [picking, setPicking] = useState(false);
  const todayDay = today && isCalendarDay(today) ? today : todayCalendarDay();
  const day = isCalendarDay(value) ? value : defaultValidUntil(todayDay);
  const passed = !!day && isExpired(day, todayDay);

  return (
    <View testID="validuntil-field">
      <View style={styles.row}>
        <Text style={styles.label}>Prices Valid Until</Text>
        <View style={styles.right}>
          <Text style={styles.value}>{day ? formatCalendarDay(day) : ''}</Text>
          <TouchableOpacity
            onPress={() => setPicking(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Change the Date Prices Are Valid Until"
            testID="validuntil-change"
          >
            <Text style={styles.change}>Change</Text>
          </TouchableOpacity>
        </View>
      </View>
      {passed ? <Text style={styles.note}>This date has passed.</Text> : null}
      <DatePickerModal
        visible={picking}
        value={day ?? ''}
        allowFuture
        title="Prices Valid Until"
        onClose={() => setPicking(false)}
        onChange={(iso) => {
          const picked = iso.slice(0, 10);
          if (isCalendarDay(picked)) onChange(picked);
          setPicking(false);
        }}
      />
    </View>
  );
}

export default ValidUntilField;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 14 },
  label: { ...Type.subheadEmphasized, color: t.text },
  right: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  value: { ...Type.subhead, color: t.text },
  change: { ...Type.subheadEmphasized, color: t.accentLabel },
  note: { ...Type.footnote, color: t.textMuted, paddingBottom: 12 },
});
