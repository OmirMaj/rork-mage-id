import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Bell } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import type { AttentionItem } from '@/utils/summaryBriefing';

interface NeedsYouProps {
  items: AttentionItem[];
  onPressItem: (item: AttentionItem) => void;
}

export function NeedsYou({ items, onPressItem }: NeedsYouProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  if (items.length === 0) return null;

  return (
    <View style={styles.card} testID="summary-needs-you">
      <View style={styles.header}>
        <View style={[styles.iconSq, { backgroundColor: colors.danger + '18' }]}>
          <Bell size={15} color={colors.danger} strokeWidth={2.2} />
        </View>
        <Text style={styles.headerLabel}>NEEDS YOU</Text>
        <Text style={[styles.headerMeta, { color: colors.danger }]}>
          {items.length} item{items.length === 1 ? '' : 's'}
        </Text>
      </View>

      {items.map((it, i) => (
        <TouchableOpacity
          key={it.id}
          style={[styles.row, i > 0 ? styles.rowDivider : null]}
          activeOpacity={0.7}
          onPress={() => onPressItem(it)}
          testID={`summary-needs-${it.id}`}
        >
          <View style={[styles.dot, { backgroundColor: it.severity === 'danger' ? colors.danger : colors.accent }]} />
          <Text style={styles.label} numberOfLines={2}>{it.label}</Text>
          <Text style={[styles.action, { color: colors.accentLabel }]}>{it.actionLabel} →</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 12, backgroundColor: t.surface, borderRadius: Tokens.radius.xl, borderWidth: 1, borderColor: t.line, padding: 14 },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 9, marginBottom: 6 },
  iconSq: { width: 26, height: 26, borderRadius: 9, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerLabel: { fontSize: 12, fontWeight: '800' as const, color: t.text, letterSpacing: 0.2 },
  headerMeta: { marginLeft: 'auto' as const, fontSize: 11, fontWeight: '700' as const },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 9 },
  rowDivider: { borderTopWidth: 1, borderTopColor: t.line },
  dot: { width: 8, height: 8, borderRadius: 5 },
  label: { flex: 1, fontSize: 12.5, fontWeight: '600' as const, color: t.textSecondary },
  action: { fontSize: 11, fontWeight: '800' as const },
});
