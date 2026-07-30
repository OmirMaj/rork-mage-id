import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { CalendarDays, Link2 } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { generateScheduleFromEstimate } from '@/utils/autoScheduleFromEstimate';
import type { Project, LinkedEstimate } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

interface AIAutoScheduleButtonProps {
  project: Project;
  estimate: LinkedEstimate;
  onScheduleCreated: (schedule: Project['schedule']) => void;
  testID?: string;
}

export default function AIAutoScheduleButton({ project, estimate, onScheduleCreated, testID }: AIAutoScheduleButtonProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { projects } = useProjects();
  const [loading, setLoading] = useState(false);

  const handlePress = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (project.schedule && project.schedule.tasks.length > 0) {
      showAlert(
        'Schedule Exists',
        'This project already has a schedule. Generating will replace it. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Replace', style: 'destructive', onPress: () => void runGenerate() },
        ],
      );
      return;
    }
    void runGenerate();
  }, [project]);

  const runGenerate = useCallback(async () => {
    setLoading(true);
    try {
      // Thread ALL projects — durations get paced from the contractor's own
      // finished tasks (utils/copilot/scheduleBuilder/paceGrounding.ts).
      const result = await generateScheduleFromEstimate(project, estimate, projects);
      onScheduleCreated(result.schedule);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert(
        'Schedule Generated',
        `Created ${result.tasks.length} tasks across ${new Set(result.tasks.map(t => t.phase)).size} phases. ${result.linkedItemCount} estimate items linked to tasks.`,
        [
          { text: 'Stay Here', style: 'cancel' },
          { text: 'View Schedule', onPress: () => router.replace('/(tabs)/schedule' as any) },
        ],
      );
    } catch (err: any) {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAlert('Generation Failed', err?.message || 'Could not build a schedule from this estimate. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [project, estimate, onScheduleCreated, router, projects]);

  const itemCount = estimate.items.length;
  const categoryCount = new Set(estimate.items.map(i => (i.category || 'general').toLowerCase())).size;

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <MageAIMark size={16} color={themeColors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Auto-Schedule from Estimate</Text>
          <Text style={styles.subtitle}>
            AI builds tasks + dependencies from your {itemCount} line item{itemCount === 1 ? '' : 's'} across {categoryCount} categor{categoryCount === 1 ? 'y' : 'ies'}.
          </Text>
        </View>
      </View>

      <View style={styles.benefitsRow}>
        <View style={styles.benefitChip}>
          <CalendarDays size={11} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.benefitText}>Realistic durations</Text>
        </View>
        <View style={styles.benefitChip}>
          <Link2 size={11} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.benefitText}>Linked to estimate items</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.actionBtn, loading && { opacity: 0.6 }]}
        onPress={handlePress}
        activeOpacity={0.85}
        disabled={loading}
        testID="auto-schedule-generate-btn"
      >
        {loading ? (
          <>
            <ActivityIndicator size="small" color="#FFF" />
            <Text style={styles.actionBtnText}>Building schedule…</Text>
          </>
        ) : (
          <>
            <MageAIMark size={15} color="#FFF" />
            <Text style={styles.actionBtnText}>Generate Schedule</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    backgroundColor: t.accent + '0C',
    borderRadius: Tokens.radius.lg,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: t.accent + '30',
  },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  iconWrap: { width: 32, height: 32, borderRadius: Tokens.radius.md, backgroundColor: t.accent + '20', alignItems: 'center' as const, justifyContent: 'center' as const },
  title: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  subtitle: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 2, lineHeight: 16 },
  benefitsRow: { flexDirection: 'row' as const, gap: 6, flexWrap: 'wrap' as const },
  benefitChip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.xs, backgroundColor: t.accent + '12' },
  benefitText: { fontSize: Type.caption2.fontSize, color: t.accent, fontWeight: '600' as const },
  actionBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 12, borderRadius: Tokens.radius.md, backgroundColor: t.accent },
  actionBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: '#FFF' },
});
