import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { AlertTriangle } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
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
  const { colors: themeColors } = useTheme();
  const { tier } = useSubscription();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    if (isLoading) return;
    // Locked (tier budget exhausted) → surface the upgrade nudge, don't generate.
    if (isLocked) { onLockedPress?.(); return; }

    const limit = await checkAILimit(tier, 'fast', 'dailyReport');
    if (!limit.allowed) {
      showAILimitAlert({ limit, router });
      return;
    }

    setError(null);
    setIsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await generateDailyReport(projectName, tasks, weatherStr);
      await recordAIUsage('fast', 'dailyReport');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onGenerated(result);
    } catch (err) {
      // Name the failure. This catch was console-only: a super tapping this at
      // 4pm on site watched the button spin, return to normal and leave the
      // report blank, with no way to tell signal loss from a broken feature
      // (audit 2026-09-07, ai-features). Same shape as AIQuickEstimate.
      console.error('[AI DFR] Generation failed:', err);
      setError(`Couldn't generate the report. ${err instanceof Error && err.message ? err.message : 'Tap to retry.'}`);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, isLocked, onLockedPress, projectName, tasks, weatherStr, onGenerated, tier, router]);

  return (
    <View>
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
      {error ? (
        <View style={styles.errorRow}>
          <AlertTriangle size={13} color={themeColors.dangerLabel} strokeWidth={1.75} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
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
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // dangerSoft, not the static `Colors.errorLight`: that tint is a baked
    // LIGHT value while `dangerLabel` themes, so inside this factory dark mode
    // put #FF5A51 ink on pale pink at 2.78:1. The themed pair measures 4.77:1
    // light / 4.79:1 dark (constants/colors.ts).
    backgroundColor: t.dangerSoft,
    borderRadius: Tokens.radius.card,
    padding: 12,
    marginBottom: 8,
  },
  errorText: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    color: t.dangerLabel,
    fontWeight: '500' as const,
    lineHeight: 18,
  },
});
