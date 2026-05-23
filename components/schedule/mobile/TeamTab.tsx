import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import { getPhaseColor } from '@/utils/scheduleEngine';
import { Tokens } from '@/constants/designTokens';

interface TeamTabProps {
  tasks: ScheduleTask[];
  onPressTask: (t: ScheduleTask) => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function TeamTab({ tasks, onPressTask }: TeamTabProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const groups = useMemo(() => {
    const order: string[] = [];
    const by = new Map<string, ScheduleTask[]>();
    for (const t of tasks) {
      const who = (t.crew || t.assignedSubName || 'Unassigned').trim() || 'Unassigned';
      if (!by.has(who)) { by.set(who, []); order.push(who); }
      by.get(who)!.push(t);
    }
    // Unassigned last
    order.sort((a, b) => (a === 'Unassigned' ? 1 : 0) - (b === 'Unassigned' ? 1 : 0));
    return order.map((who) => ({ who, tasks: by.get(who)! }));
  }, [tasks]);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
      {groups.map((g) => {
        const open = g.tasks.filter((t) => t.status !== 'done').length;
        return (
          <View key={g.who} style={styles.group}>
            <View style={styles.ghead}>
              <View style={[styles.avatar, { backgroundColor: g.who === 'Unassigned' ? colors.textMuted : colors.accent }]}>
                <Text style={styles.avatarText}>{g.who === 'Unassigned' ? '–' : initials(g.who)}</Text>
              </View>
              <Text style={styles.gname} numberOfLines={1}>{g.who}</Text>
              <Text style={styles.gmeta}>{open} open · {g.tasks.length}</Text>
            </View>
            <View style={styles.card}>
              {g.tasks.map((t, i) => (
                <TouchableOpacity key={t.id} style={[styles.trow, i > 0 ? styles.rowDivider : null]} activeOpacity={0.7} onPress={() => onPressTask(t)}>
                  <View style={[styles.dot, { backgroundColor: getPhaseColor(t.phase || 'Other') }]} />
                  <Text style={[styles.tname, t.status === 'done' ? { color: colors.textMuted, textDecorationLine: 'line-through' } : null]} numberOfLines={1}>{t.title}</Text>
                  <Text style={styles.tpct}>{t.progress ?? 0}%</Text>
                  <ChevronRight size={15} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  group: { marginBottom: 18 },
  ghead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 9, marginBottom: 8, marginLeft: 2 },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center' as const, justifyContent: 'center' as const },
  avatarText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' as const },
  gname: { flex: 1, fontSize: 14, fontWeight: '800' as const, color: t.text },
  gmeta: { fontSize: 11, fontWeight: '700' as const, color: t.textMuted },
  card: { backgroundColor: t.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line, paddingHorizontal: 14 },
  trow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 9, paddingVertical: 10 },
  rowDivider: { borderTopWidth: 1, borderTopColor: t.line },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tname: { flex: 1, fontSize: 13, fontWeight: '600' as const, color: t.text },
  tpct: { fontSize: 11, fontWeight: '800' as const, color: t.textSecondary },
});
