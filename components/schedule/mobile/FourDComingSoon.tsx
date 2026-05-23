import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Box } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';

/** Placeholder for the (deferred) 4D BIM viewer. Used both as the "4D Model"
 *  sub-tab body and inside the task-detail sheet's preview slot. */
export function FourDComingSoon({ compact = false }: { compact?: boolean }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.wrap, compact ? styles.compact : null]}>
      <View style={styles.iconWrap}>
        <Box size={compact ? 24 : 34} color={colors.accent} strokeWidth={1.8} />
      </View>
      <Text style={styles.title}>4D model — coming soon</Text>
      <Text style={styles.body}>
        Link your BIM / 3D model to watch the build play out over time, level by level.
      </Text>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { alignItems: 'center' as const, justifyContent: 'center' as const, padding: 28, gap: 10, backgroundColor: t.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line, marginHorizontal: 16, marginTop: 12 },
  compact: { padding: 18, marginHorizontal: 0 },
  iconWrap: { width: 56, height: 56, borderRadius: 18, backgroundColor: t.accentSoft, alignItems: 'center' as const, justifyContent: 'center' as const },
  title: { fontSize: 15, fontWeight: '800' as const, color: t.text, letterSpacing: -0.2 },
  body: { fontSize: 12.5, fontWeight: '500' as const, color: t.textMuted, textAlign: 'center' as const, lineHeight: 18, maxWidth: 260 },
});
