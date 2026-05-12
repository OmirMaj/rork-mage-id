// components/schedule/StatusPill.tsx — Phase 27.
//
// Tiny rounded badge: "● On Track" / "● At Risk" / "● Late".
// Colored by status. Used in SchedulerHeader and in the project card.
//
// Theme-aware via useTheme(); pill colors come from Colors token shortcuts
// (pillOnTrack / pillAtRisk / pillLate).

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
  useTheme(); // subscribe so the pill recolors on theme change
  const c = status === 'on_track' ? Colors.pillOnTrack
          : status === 'at_risk'  ? Colors.pillAtRisk
          :                          Colors.pillLate;
  const isSm = size === 'sm';
  return (
    <View style={[
      styles.pill,
      { backgroundColor: c + '22' },  // 22 hex = ~13% alpha (tinted bg)
      isSm && styles.pillSm,
    ]}>
      <View style={[styles.dot, { backgroundColor: c }]} />
      <Text style={[styles.label, { color: c }, isSm && styles.labelSm]}>
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
