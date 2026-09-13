import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { RefreshCw, TrendingUp, ArrowRight, Tag, ClipboardList } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import {
  analyzeEquipmentRentVsBuy, getCachedResult, setCachedResult,
  type EquipmentAdviceResult,
} from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { parseCalendarDay } from '@/utils/calendarDate';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import { useRouter } from 'expo-router';
import type { Equipment } from '@/types';
import type { SubscriptionTierKey } from '@/utils/aiRateLimiter';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

interface Props {
  equipment: Equipment;
  subscriptionTier: SubscriptionTierKey;
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

const REC_STYLES = {
  rent: { label: 'Keep Renting', Icon: RefreshCw, color: "#1565C0", bg: Colors.infoLight },
  buy: { label: 'Buy It', Icon: Tag, color: "#2E7D44", bg: Colors.successLight },
  lease: { label: 'Consider Leasing', Icon: ClipboardList, color: Colors.warningLabel, bg: Colors.warningLight },
} as const;

/** The arithmetic, or the one sentence saying what is missing. */
type MeasuredUsage =
  | {
      ok: true;
      /** Distinct jobs NAMED by the log. Genuinely 0 when none of them is. */
      projects: number;
      jobsNamed: boolean;
      daysUsed: number;
      spanDays: number;
      /** daysUsed × dailyRate. Money SPENT only on a rented machine — see the
       *  tile label below; on one they own, this is what those days are worth
       *  at the rate they set, not an outlay. */
      costAtDayRate: number;
    }
  | { ok: false; reason: string };

/**
 * What the utilization log actually proves about this machine. Every figure
 * here is arithmetic on rows the GC entered — nothing is asked of a model.
 *
 * Refuses with a reason instead of inventing inputs: the panel used to floor
 * the job count (`Math.max(uniqueProjects, 2)`) and hardcode 12 days per
 * project, so a machine that had never been logged still produced a confident
 * annual rental figure and a rent/buy verdict built on it (audit 2026-09-07,
 * ai-features). Two more refusals were added on review: a day rate of 0 —
 * which the add form allows (`parseFloat(newDailyRate) || 0`,
 * app/(tabs)/equipment/index.tsx:101) — priced every logged day at $0 and
 * printed it as a measured figure.
 */
function measuredUsage(equipment: Equipment): MeasuredUsage {
  const owned = equipment.type !== 'rented';
  const log = equipment.utilizationLog ?? [];
  const hours = log.reduce((s, u) => s + (Number.isFinite(u.hoursUsed) ? u.hoursUsed : 0), 0);
  const daysUsed = hours / 8;
  if (daysUsed <= 0) {
    return {
      ok: false,
      reason: owned
        ? "Log some usage on this machine and MAGE can tell you whether owning it still pays. Rent vs buy turns on your real days — it won't guess them."
        : "Log some usage on this machine and MAGE can tell you whether to keep renting. Rent vs buy turns on your real days — it won't guess them.",
    };
  }
  const rate = Number.isFinite(equipment.dailyRate) ? equipment.dailyRate : 0;
  if (rate <= 0) {
    // Points at the Daily Rate ($) field on this same screen
    // (app/equipment-detail.tsx:180) — a blocked control names a control that
    // exists.
    return {
      ok: false,
      reason: `Set a Daily Rate above and MAGE can price the ${daysUsed < 10 ? daysUsed.toFixed(1) : Math.round(daysUsed)} days already logged. Rent vs buy is a comparison against what a day on this machine costs — it won't guess that either.`,
    };
  }
  const projects = new Set(log.map(u => u.projectId).filter(Boolean)).size;
  // parseCalendarDay, not `new Date(u.date)`. The span below is a DIFFERENCE of
  // two dates parsed the same way, so a UTC-vs-local offset would cancel and the
  // number would be right either way — but a bare parse on a 'YYYY-MM-DD' is the
  // shape that names the wrong day everywhere else in this codebase, and
  // scripts/validate-calendar-date.ts is deliberately blind to whether a given
  // one happens to be harmless. Use the helper and the question never arises.
  const times = log
    .map(u => parseCalendarDay(u.date)?.getTime())
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  const spanDays = times.length > 1
    ? Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 86_400_000) + 1)
    : 1;
  return {
    ok: true,
    projects,
    jobsNamed: projects > 0,
    daysUsed,
    spanDays,
    costAtDayRate: daysUsed * rate,
  };
}

export default React.memo(function AIEquipmentAdvice({ equipment, subscriptionTier }: Props) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [result, setResult] = useState<EquipmentAdviceResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const usage = useMemo(() => measuredUsage(equipment), [equipment]);

  const handleAnalyze = useCallback(async () => {
    if (isLoading || !usage.ok) return;

    const cacheKey = `equip_advice_${equipment.id}`;
    const cached = await getCachedResult<EquipmentAdviceResult>(cacheKey, SEVEN_DAYS);
    if (cached) {
      setResult(cached);
      return;
    }

    const limit = await checkAILimit(subscriptionTier, 'fast', 'equipmentAdvice');
    if (!limit.allowed) {
      showAILimitAlert({ limit, router });
      return;
    }

    setIsLoading(true);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // The GC's own log, with no filler: the model gets what happened, or the
      // button never fires (see `usage`). `jobs` floors at 1 ONLY because a
      // machine with logged hours ran on at least one job — a true lower bound,
      // not the `Math.max(uniqueProjects, 2)` this replaced, which claimed two
      // jobs for a machine with an empty log. The floor is reached often: the
      // Log Usage sheet has no project picker (app/equipment-detail.tsx:299),
      // so an unassigned machine records every entry with projectId '' and
      // `projects` is legitimately 0. The tile below prints that as unknown
      // rather than as 1 — a lower bound is not a measurement.
      const jobs = Math.max(usage.projects, 1);
      const avgDaysPerProject = Math.max(1, Math.round(usage.daysUsed / jobs));
      const data = await analyzeEquipmentRentVsBuy(equipment, jobs, avgDaysPerProject);
      await recordAIUsage('fast', 'equipmentAdvice');
      await setCachedResult(cacheKey, data);
      setResult(data);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.log('[AI Equipment] Analysis failed:', err);
      showAlert('AI Error', 'Could not analyze equipment. Try again.');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, equipment, subscriptionTier, usage, router]);

  if (!result) {
    // A blocked control says why, in the machine's own terms — `measuredUsage`
    // carries the reason, so an owner is never told to "keep renting" a thing
    // they already own and a $0 day rate names the field that fixes it.
    if (!usage.ok) {
      return (
        <View style={styles.blockedBox}>
          <MageAIMark size={14} color={themeColors.textMuted} />
          <Text style={styles.blockedText}>{usage.reason}</Text>
        </View>
      );
    }
    return (
      <TouchableOpacity style={styles.triggerBtn} onPress={handleAnalyze} activeOpacity={0.7} disabled={isLoading}>
        {isLoading ? (
          <ActivityIndicator size="small" color={"#FF6A1A"} />
        ) : (
          <MageAIMark size={16} color={"#FF6A1A"} />
        )}
        <Text style={styles.triggerText}>{isLoading ? 'Analyzing...' : 'AI Rent vs Buy Advice'}</Text>
      </TouchableOpacity>
    );
  }

  const rec = REC_STYLES[result.recommendation] ?? REC_STYLES.rent;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <MageAIMark size={12} color={"#FF6A1A"} />
        <Text style={styles.headerTitle}>Rent vs Buy: {equipment.name}</Text>
        <Text style={styles.aiTag}>AI-generated</Text>
      </View>

      <View style={[styles.recBadge, { backgroundColor: rec.bg }]}>
        <rec.Icon size={15} color={rec.color} strokeWidth={2} />
        <Text style={[styles.recLabel, { color: rec.color }]}>RECOMMENDATION: {rec.label.toUpperCase()}</Text>
      </View>

      {/* Every tile is arithmetic on the GC's own utilization log.
          What used to be here: the model's echo of `annualRentalCost` — a
          number the prompt had already computed and handed it, so the tile
          could disagree with the arithmetic behind it — beside a "Purchase
          price" the relay recalled with no catalog and no browsing, and a
          "Break-even" derived from that price which rendered literally as
          "0+ projects/yr" whenever the model returned nothing
          (audit 2026-09-07, ai-features). */}
      {usage.ok ? (
        <>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              {/* `dailyRate` is what a day on this machine COSTS — rent the GC
                  pays on a rented one, the charge-out rate they set on one they
                  own (types/index.ts:3460, and 'owned' is the default the add
                  form starts on). Labelling both "Rent paid" told an owner they
                  had spent money they never spent. */}
              <Text style={styles.statLabel}>{equipment.type === 'rented' ? 'Rent paid' : 'At your day rate'}</Text>
              <Text style={styles.statValue}>${Math.round(usage.costAtDayRate).toLocaleString()}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Days used</Text>
              <Text style={styles.statValue}>{usage.daysUsed < 10 ? usage.daysUsed.toFixed(1) : Math.round(usage.daysUsed).toLocaleString()}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Jobs</Text>
              {/* Not a floor of 1. The Log Usage sheet has no project picker, so
                  an unassigned machine logs every entry with projectId '' —
                  printing "1" there would be MAGE counting a job it never saw. */}
              <Text style={[styles.statValue, !usage.jobsNamed && styles.statValueUnknown]}>
                {usage.jobsNamed ? usage.projects : 'Not logged'}
              </Text>
            </View>
          </View>
          <Text style={styles.groundingChip}>
            Measured from {equipment.utilizationLog.length} utilization {equipment.utilizationLog.length === 1 ? 'entry' : 'entries'} over{' '}
            {usage.spanDays} {usage.spanDays === 1 ? 'day' : 'days'}, at your ${equipment.dailyRate.toLocaleString()}/day rate
            {equipment.type === 'rented'
              ? '.'
              : ' — what those days are worth at the rate you set, not rent you paid: this machine is marked Owned.'}
            {usage.jobsNamed ? '' : ' No entry names a job, so the split across jobs is unknown.'}
          </Text>
        </>
      ) : null}

      <Text style={styles.reasoning}>{result.reasoning}</Text>

      {/* The verdict above is the model's judgement, and any purchase price in
          it is recall — the relay has no equipment catalog and no browsing. */}
      <Text style={styles.groundingChip}>
        Any purchase price named above is the model&apos;s recall, not a quote — MAGE has
        no equipment price feed. Confirm it with your dealer before you buy.
      </Text>

      <View style={styles.reconsiderRow}>
        <ArrowRight size={12} color={themeColors.textMuted} strokeWidth={1.75} />
        <Text style={styles.reconsiderText}>{result.reconsiderWhen}</Text>
      </View>
    </View>
  );
});

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  triggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: t.accent + '10',
    borderRadius: Tokens.radius.card,
    paddingVertical: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: t.accent + '25',
  },
  triggerText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.accent,
  },
  container: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: t.line,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    flex: 1,
  },
  aiTag: {
    fontSize: 10,
    color: t.textMuted,
  },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: Tokens.radius.md,
    padding: 12,
    marginBottom: 12,
  },
  recIcon: {
    fontSize: Type.subheadline.fontSize,
  },
  recLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  statItem: {
    flex: 1,
    backgroundColor: Colors.fillSecondary,
    borderRadius: Tokens.radius.sm,
    padding: 10,
    alignItems: 'center',
    gap: 2,
  },
  statLabel: {
    fontSize: 10,
    color: t.textMuted,
    fontWeight: '500' as const,
  },
  statValue: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    textAlign: 'center' as const,
  },
  statValueUnknown: {
    color: t.textMuted,
    fontSize: Type.footnote.fontSize,
  },
  groundingChip: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    lineHeight: 15,
    marginBottom: 10,
  },
  blockedBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.card,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: t.line,
  },
  blockedText: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    lineHeight: 17,
  },
  reasoning: {
    fontSize: Type.footnote.fontSize,
    color: t.text,
    lineHeight: 19,
    marginBottom: 8,
  },
  reconsiderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.fillSecondary,
    borderRadius: Tokens.radius.sm,
    padding: 10,
  },
  reconsiderText: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    flex: 1,
    lineHeight: 17,
    fontStyle: 'italic' as const,
  },
});
