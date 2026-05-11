// EyebrowLabel — the recurring "dot + mono-uppercase" pattern.
//
// Used above section titles, in card headers, in screen eyebrows.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

interface Props {
  children: string;
  tone?: 'amber' | 'success' | 'neutral';
  showDot?: boolean;
}

export function EyebrowLabel({ children, tone = 'amber', showDot = true }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const color =
    tone === 'amber' ? colors.accentLabel :
    tone === 'success' ? colors.success :
    colors.textSecondary;

  return (
    <View style={styles.row}>
      {showDot ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
      <Text style={[Type.monoEyebrow, { color }]}>{children}</Text>
    </View>
  );
}

const makeStyles = (_t: ThemeColors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dot: { width: 5, height: 5, borderRadius: Tokens.radius.full },
  });

export default EyebrowLabel;
