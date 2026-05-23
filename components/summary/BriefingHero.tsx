import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MoreHorizontal } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';

interface BriefingHeroProps {
  /** Already-resolved first name, or '' for a plain greeting. */
  greetingName: string;
  /** Count behind the danger pill; pill hidden when 0. */
  attentionCount: number;
  /** Count behind the muted "N active" pill. */
  activeCount: number;
  /** The ••• overflow button. */
  onOpenTools: () => void;
}

export function BriefingHero({ greetingName, attentionCount, activeCount, onOpenTools }: BriefingHeroProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const dateLine = new Date()
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    .toUpperCase();
  const greeting = greetingName ? `Good morning, ${greetingName}` : 'Good morning';

  return (
    <View style={styles.wrap}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.date}>{dateLine}</Text>
        <Text style={styles.greet} numberOfLines={1}>{greeting}</Text>
        <View style={styles.pills}>
          {attentionCount > 0 && (
            <View style={[styles.pill, { backgroundColor: colors.danger + '18' }]}>
              <Text style={[styles.pillText, { color: colors.danger }]}>
                {attentionCount} need{attentionCount === 1 ? 's' : ''} attention
              </Text>
            </View>
          )}
          <View style={[styles.pill, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={[styles.pillText, { color: colors.textMuted }]}>{activeCount} active</Text>
          </View>
        </View>
      </View>
      <TouchableOpacity
        style={styles.toolsBtn}
        onPress={onOpenTools}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="More tools"
        testID="summary-tools-button"
      >
        <MoreHorizontal size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 14, gap: 10 },
  date: { fontSize: Type.caption2.fontSize, fontWeight: '800' as const, color: t.accentLabel, letterSpacing: 1 },
  greet: { fontSize: Type.largeTitle.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.6, marginTop: 3 },
  pills: { flexDirection: 'row' as const, gap: 8, marginTop: 10, flexWrap: 'wrap' as const },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  pillText: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.1 },
  toolsBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, alignItems: 'center' as const, justifyContent: 'center' as const, marginTop: 4 },
});
