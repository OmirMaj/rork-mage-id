import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { generateDailyReport, type DailyReportGenResult } from '@/utils/aiService';
import type { ScheduleTask } from '@/types';

interface Props {
  projectName: string;
  tasks: ScheduleTask[];
  weatherStr: string;
  onGenerated: (result: DailyReportGenResult) => void;
}

export default React.memo(function AIDailyReportGen({ projectName, tasks, weatherStr, onGenerated }: Props) {
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerate = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await generateDailyReport(projectName, tasks, weatherStr);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onGenerated(result);
    } catch (err) {
      console.error('[AI DFR] Generation failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, projectName, tasks, weatherStr, onGenerated]);

  return (
    <TouchableOpacity style={styles.btn} onPress={handleGenerate} disabled={isLoading}>
      {isLoading ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <Sparkles size={16} color="#FFFFFF" />
      )}
      <Text style={styles.btnText}>
        {isLoading ? 'Generating...' : 'Auto-Generate from Schedule'}
      </Text>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    marginVertical: 8,
  },
  btnText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
});
