// BidDriverRow — one line of the JUDGES verdict's "why". Renders a
// kind-specific lucide icon, the engine's plain number-bearing sentence,
// and a small polarity dot (positive → success green, negative → hot
// amber). Presentation only; all numbers come pre-computed from the engine.
//
// Theming mirrors app/cost-xray.tsx: useTheme() + useThemedStyles(makeStyles),
// Type.* text tokens, Tokens.radius.*, semantic ThemeColors — no raw hex.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  Database, TrendingUp, History, CalendarClock, AlertTriangle, Scale,
  type LucideIcon,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import type { BidDriver } from '@/utils/judges/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const KIND_ICON: Record<BidDriver['kind'], LucideIcon> = {
  cost_confidence: Database,
  margin: TrendingUp,
  track_record: History,
  capacity: CalendarClock,
  risk: AlertTriangle,
  calibration: Scale,
};

export function BidDriverRow({ driver }: { driver: BidDriver }) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const Icon = KIND_ICON[driver.kind] ?? Scale;
  const positive = driver.polarity === 'positive';
  const dotColor = positive ? t.success : t.accentHot;

  return (
    <View style={styles.row}>
      <View style={styles.iconWrap}>
        <Icon size={16} color={t.textSecondary} strokeWidth={1.75} />
      </View>
      <Text style={styles.detail}>{driver.detail}</Text>
      <View
        style={[styles.dot, { backgroundColor: dotColor }]}
        accessibilityLabel={positive ? 'positive factor' : 'negative factor'}
      />
    </View>
  );
}

export default BidDriverRow;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    paddingVertical: 8,
  },
  iconWrap: { width: 20, alignItems: 'center' as const, paddingTop: 1 },
  detail: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    lineHeight: Type.footnote.lineHeight,
    color: t.textSecondary,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Tokens.radius.full,
    marginTop: 6,
  },
});
