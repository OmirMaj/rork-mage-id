// components/schedule/StatusPill.tsx — Phase 27.
//
// Tiny rounded badge: "● On Track" / "● At Risk" / "● Late".
// Colored by status. Used in SchedulerHeader and in the project card.
//
// The DOT and the tint carry the signal, so they stay the vivid pill hues
// (pillOnTrack / pillAtRisk / pillLate) — those have to be unmistakable from
// each other, which is the whole job of a signal fill (constants/colors.ts).
// The LABEL is text on that tint, so it takes the theme's label ink instead.
// Until 2026-09-07 the label used the vivid hue too, and this file carried a
// bare `useTheme()` commented "subscribe so the pill recolors on theme change"
// — it recolored nothing, because every colour here was a static token. The
// hook is load-bearing now.

import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { pillLabel, type PillStatus } from '@/utils/scheduleHealth';

export interface StatusPillProps {
  status: PillStatus;
  /** Smaller size for cards / list rows. Default 'md'. */
  size?: 'sm' | 'md';
}

export function StatusPill({ status, size = 'md' }: StatusPillProps) {
  const { colors: t } = useTheme();
  const c = status === 'on_track' ? Colors.pillOnTrack
          : status === 'at_risk'  ? Colors.pillAtRisk
          :                          Colors.pillLate;
  // Measured on the pill's own `c + '22'` tint, light theme / dark theme:
  //   on_track  1.76 -> 5.92   |  7.18 -> 7.18 (unchanged)
  //   at_risk   1.77 -> 4.77   |  7.18 -> 6.35
  //   late      2.64 -> 4.87   |  4.94 -> 4.94 (unchanged)
  // In light mode the label was a coloured smear at 1.8:1; the *Label tokens
  // are exactly this tint-and-ink pairing. Two of the three dark values are
  // untouched because those tokens already mirror the pill hue in dark.
  const ink = status === 'on_track' ? t.successLabel
            : status === 'at_risk'  ? t.warningLabel
            :                          t.dangerLabel;
  const isSm = size === 'sm';
  return (
    <View style={[
      styles.pill,
      { backgroundColor: c + '22' },  // 22 hex = ~13% alpha (tinted bg)
      isSm && styles.pillSm,
    ]}>
      <View style={[styles.dot, { backgroundColor: c }]} />
      <Text style={[styles.label, { color: ink }, isSm && styles.labelSm]}>
        {pillLabel(status).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 99,
    alignSelf: 'flex-start',
    gap: 5,
  },
  pillSm: { paddingHorizontal: 7, paddingVertical: 2, gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  labelSm: { fontSize: 9, letterSpacing: 0.5 },
});
