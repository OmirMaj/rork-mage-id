import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { generateDailyReport, type DailyReportGenResult } from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useRouter } from 'expo-router';
import type { ScheduleTask } from '@/types';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';

interface Props {
  projectName: string;
  tasks: ScheduleTask[];
  weatherStr: string;
  onGenerated: (result: DailyReportGenResult) => void;
  /** When true, this AI path is out of budget for the current tier — tapping
   *  routes to the upgrade nudge instead of generating. Mirrors the lock the
   *  sibling AI surfaces (VoiceRecorder / AIDFRFromPhotos) already expose so
   *  every AI generation button on the DFR nudges toward upgrade consistently. */
  isLocked?: boolean;
  onLockedPress?: () => void;
}

export default React.memo(function AIDailyReportGen({ projectName, tasks, weatherStr, onGenerated, isLocked, onLockedPress }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { tier } = useSubscription();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerate = useCallback(async () => {
    if (isLoading) return;
    // Locked (tier budget exhausted) → surface the upgrade nudge, don't generate.
    if (isLocked) { onLockedPress?.(); return; }

    const limit = await checkAILimit(tier, 'fast', 'dailyReport');
    if (!limit.allowed) {
      showAILimitAlert({ limit, router });
      return;
    }

    setIsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await generateDailyReport(projectName, tasks, weatherStr);
      await recordAIUsage('fast', 'dailyReport');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onGenerated(result);
    } catch (err) {
      console.error('[AI DFR] Generation failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, isLocked, onLockedPress, projectName, tasks, weatherStr, onGenerated, tier, router]);

  return (
    <TouchableOpacity style={styles.btn} onPress={handleGenerate} disabled={isLoading}>
      {isLoading ? (
        <ActivityIndicator size="small" color={"#FFFFFF"} />
      ) : (
        <MageAIMark size={16} color={"#FFFFFF"} />
      )}
      <Text style={styles.btnText}>
        {isLoading ? 'Generating...' : 'Auto-Generate from Schedule'}
      </Text>
    </TouchableOpacity>
  );
});

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: t.accentFill,
    borderRadius: Tokens.radius.card,
    marginVertical: 8,
  },
  btnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.surface,
  },
});
