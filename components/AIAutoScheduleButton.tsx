import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Sparkles, CalendarDays, Link2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { generateScheduleFromEstimate } from '@/utils/autoScheduleFromEstimate';
import type { Project, LinkedEstimate } from '@/types';

interface AIAutoScheduleButtonProps {
  project: Project;
  estimate: LinkedEstimate;
  onScheduleCreated: (schedule: Project['schedule']) => void;
  testID?: string;
}

export default function AIAutoScheduleButton({ project, estimate, onScheduleCreated, testID }: AIAutoScheduleButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handlePress = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (project.schedule && project.schedule.tasks.length > 0) {
      Alert.alert(
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
      const result = await generateScheduleFromEstimate(project, estimate);
      onScheduleCreated(result.schedule);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Schedule Generated',
        `Created ${result.tasks.length} tasks across ${new Set(result.tasks.map(t => t.phase)).size} phases. ${result.linkedItemCount} estimate items linked to tasks.`,
        [
          { text: 'Stay Here', style: 'cancel' },
          { text: 'View Schedule', onPress: () => router.replace('/(tabs)/schedule' as any) },
        ],
      );
    } catch (err: any) {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Generation Failed', err?.message || 'Could not build a schedule from this estimate. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [project, estimate, onScheduleCreated, router]);

  const itemCount = estimate.items.length;
  const categoryCount = new Set(estimate.items.map(i => (i.category || 'general').toLowerCase())).size;

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Sparkles size={16} color={Colors.accent} />
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
          <CalendarDays size={11} color={Colors.primary} />
          <Text style={styles.benefitText}>Realistic durations</Text>
        </View>
        <View style={styles.benefitChip}>
          <Link2 size={11} color={Colors.primary} />
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
            <Sparkles size={15} color="#FFF" />
            <Text style={styles.actionBtnText}>Generate Schedule</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.accent + '0C',
    borderRadius: 14,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.accent + '30',
  },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, backgroundColor: Colors.accent + '20', alignItems: 'center' as const, justifyContent: 'center' as const },
  title: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  subtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 },
  benefitsRow: { flexDirection: 'row' as const, gap: 6, flexWrap: 'wrap' as const },
  benefitChip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: Colors.primary + '12' },
  benefitText: { fontSize: 11, color: Colors.primary, fontWeight: '600' as const },
  actionBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.accent },
  actionBtnText: { fontSize: 14, fontWeight: '700' as const, color: '#FFF' },
});
