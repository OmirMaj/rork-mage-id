// Badge — small status pill (mono uppercase + soft tinted bg).

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';

export type BadgeTone = 'success' | 'warn' | 'info' | 'danger' | 'neutral';

interface Props {
  children: string;
  tone?: BadgeTone;
  dot?: boolean;
}

function tonePalette(t: ThemeColors, tone: BadgeTone) {
  switch (tone) {
    case 'success': return { fg: t.success, bg: t.successSoft, border: t.success + '33' };
    case 'warn':    return { fg: t.accentLabel, bg: t.accentSoft, border: t.accent + '40' };
    case 'info':    return { fg: t.info, bg: t.info + '1F', border: t.info + '33' };
    case 'danger':  return { fg: t.danger, bg: t.danger + '1F', border: t.danger + '33' };
    case 'neutral':
    default:        return { fg: t.textSecondary, bg: t.surfaceAlt, border: t.line };
  }
}

export function Badge({ children, tone = 'neutral', dot = false }: Props) {
  const { colors } = useTheme();
  const p = tonePalette(colors, tone);
  return (
    <View style={[styles.pill, { backgroundColor: p.bg, borderColor: p.border }]}>
      {dot ? <View style={[styles.dot, { backgroundColor: p.fg }]} /> : null}
      <Text style={[Type.monoLabel, { color: p.fg }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
    ...Tokens.continuousCorners,
  },
  dot: { width: 5, height: 5, borderRadius: 999 },
});

export default Badge;
