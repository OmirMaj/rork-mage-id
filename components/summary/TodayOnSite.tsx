import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CalendarClock, ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { chipInitials, type TodayTask } from '@/utils/summaryBriefing';

interface TodayOnSiteProps {
  tasks: TodayTask[];
  jobCount: number;
  onPressTask: (projectId: string) => void;
}

export function TodayOnSite({ tasks, jobCount, onPressTask }: TodayOnSiteProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.card} testID="summary-today">
      <View style={styles.header}>
        <View style={[styles.iconSq, { backgroundColor: colors.accentSoft }]}>
          <CalendarClock size={15} color={colors.accent} strokeWidth={2.2} />
        </View>
        <Text style={styles.headerLabel}>TODAY ON SITE</Text>
        <Text style={styles.headerMeta}>
          {tasks.length} task{tasks.length === 1 ? '' : 's'} · {jobCount} job{jobCount === 1 ? '' : 's'}
        </Text>
      </View>

      {tasks.length === 0 ? (
        <Text style={styles.empty}>Nothing scheduled on site today.</Text>
      ) : (
        tasks.map((t, i) => (
          <TouchableOpacity
            key={`${t.projectId}-${t.taskTitle}-${i}`}
            style={[styles.row, i > 0 ? styles.rowDivider : null]}
            activeOpacity={0.7}
            onPress={() => onPressTask(t.projectId)}
            testID={`summary-today-row-${i}`}
          >
            <View style={[styles.chip, { backgroundColor: t.projectColor }]}>
              <Text style={styles.chipText}>{chipInitials(t.projectName)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title} numberOfLines={1}>{t.taskTitle}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {t.projectName}{t.context ? ` · ${t.context}` : ''}
              </Text>
            </View>
            {t.isCritical ? (
              <View style={[styles.flag, { backgroundColor: colors.danger + '18' }]}>
                <Text style={[styles.flagText, { color: colors.danger }]}>CRIT</Text>
              </View>
            ) : (
              <ChevronRight size={16} color={colors.textMuted} />
            )}
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 12, backgroundColor: t.surface, borderRadius: Tokens.radius.xl, borderWidth: 1, borderColor: t.line, padding: 14 },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 9, marginBottom: 10 },
  iconSq: { width: 26, height: 26, borderRadius: 9, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerLabel: { fontSize: 12, fontWeight: '800' as const, color: t.text, letterSpacing: 0.2 },
  headerMeta: { marginLeft: 'auto' as const, fontSize: 11, fontWeight: '700' as const, color: t.textMuted },
  empty: { fontSize: 13, color: t.textMuted, fontWeight: '500' as const, paddingVertical: 8, textAlign: 'center' as const },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 11, paddingVertical: 9 },
  rowDivider: { borderTopWidth: 1, borderTopColor: t.line },
  chip: { width: 30, height: 30, borderRadius: 9, alignItems: 'center' as const, justifyContent: 'center' as const },
  chipText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' as const, letterSpacing: -0.2 },
  title: { fontSize: 13.5, fontWeight: '700' as const, color: t.text, letterSpacing: -0.1 },
  sub: { fontSize: 11, fontWeight: '600' as const, color: t.textMuted, marginTop: 1 },
  flag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  flagText: { fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.3 },
});
