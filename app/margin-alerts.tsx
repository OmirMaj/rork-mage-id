// margin-alerts.tsx — the push half of the margin train.
//
// Living Estimate / Margin Risk / the Margin Board all wait for you to open them.
// This screen remembers where every active job's margin stood last time you
// looked and shows only what CROSSED since: a risk band that stepped up, margin
// health that degraded, a job that went underwater, erosion that deepened past a
// point threshold. Recoveries show too, so the loop closes both ways.
//
// State model: we persist the per-project baseline you last acknowledged
// (AsyncStorage). Alerts = diff(current, acknowledged). "Mark all read" stamps
// the current state as the new baseline, so a given crossing clears once you've
// seen it and never nags again — but an unread crossing survives app restarts.
//
// Pure aggregation over utils/marginAlerts (which sits on the shipped engines).
// No new math, no network.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ChevronLeft, ChevronRight, BellRing, BellOff,
  TrendingDown, TrendingUp, CheckCheck,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import {
  computeCurrentBaselines, computeAlerts, countActionable,
  MARGIN_ALERTS_BASELINE_KEY,
  type BaselineMap, type MarginAlert, type AlertSeverity,
} from '@/utils/marginAlerts';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

function colorForAlert(a: MarginAlert, t: ThemeColors): string {
  if (a.direction === 'recovered') return t.success;
  switch (a.severity) {
    case 'critical': return t.danger;
    case 'high': return t.accentHot;
    case 'warning': return t.accent;
    case 'info': return t.textMuted;
  }
}

function severityLabel(s: AlertSeverity): string {
  switch (s) {
    case 'critical': return 'Critical';
    case 'high': return 'High';
    case 'warning': return 'Watch';
    case 'info': return 'Update';
  }
}

const pct = (r: number): string => `${(r * 100).toFixed(1)}%`;

export default function MarginAlertsScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return (
      <Paywall
        visible={true}
        feature="Margin Alerts"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <MarginAlertsInner />;
}

function MarginAlertsInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, changeOrders, commitments, invoices } = useProjects();

  const [acknowledged, setAcknowledged] = useState<BaselineMap>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(MARGIN_ALERTS_BASELINE_KEY);
        if (alive && raw) setAcknowledged(JSON.parse(raw) as BaselineMap);
      } catch {
        // Corrupt/missing baseline = treat everything as first-sight.
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  const { baselines, names } = useMemo(
    () => computeCurrentBaselines({ projects, changeOrders, commitments, invoices }),
    [projects, changeOrders, commitments, invoices],
  );

  const alerts = useMemo(
    () => (loaded ? computeAlerts(baselines, names, acknowledged) : []),
    [loaded, baselines, names, acknowledged],
  );

  const actionable = countActionable(alerts);
  const trackedCount = Object.keys(baselines).length;

  const markAllRead = useCallback(async () => {
    setAcknowledged(baselines);
    try {
      await AsyncStorage.setItem(MARGIN_ALERTS_BASELINE_KEY, JSON.stringify(baselines));
    } catch {
      // Non-fatal; the in-memory ack still clears the list this session.
    }
  }, [baselines]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Margin Alerts · MAGE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>What changed</Text>
        </View>
        {alerts.length > 0 ? (
          <TouchableOpacity onPress={markAllRead} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Mark all read" testID="margin-alerts-mark-read">
            <CheckCheck size={20} color={t.accent} />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      {alerts.length === 0 ? (
        <EmptyState
          icon={<BellOff size={36} color={t.success} strokeWidth={1.6} />}
          title={trackedCount > 0 ? 'No new margin alerts' : 'Nothing to watch yet'}
          message={
            trackedCount > 0
              ? `Watching ${trackedCount} active job${trackedCount === 1 ? '' : 's'}. You'll be alerted the moment one's risk steps up, margin health degrades, a job goes underwater, or erosion deepens.`
              : 'Margin Alerts watches every active job and tells you when its margin slips. To populate it:'
          }
          steps={
            trackedCount > 0
              ? undefined
              : [
                  'Mark projects as estimated or in progress.',
                  'Give each an estimate with markup so there is a margin to track.',
                  'Award buyout and approve change orders — alerts fire as margin moves.',
                ]
          }
          actionLabel={trackedCount > 0 ? 'Open Margin Board' : 'Open Projects'}
          onAction={() =>
            trackedCount > 0
              ? router.push('/portfolio-margin' as any)
              : router.push('/(tabs)/(home)' as any)
          }
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} showsVerticalScrollIndicator={false}>
          <View style={styles.summary}>
            <BellRing size={16} color={actionable > 0 ? t.danger : t.success} />
            <Text style={styles.summaryText}>
              {actionable > 0 ? (
                <><Text style={styles.summaryStrong}>{actionable}</Text> job{actionable === 1 ? '' : 's'} need attention since you last looked.</>
              ) : (
                <>Good news only — recoveries since you last looked.</>
              )}
            </Text>
          </View>

          {alerts.map(a => {
            const c = colorForAlert(a, t);
            const Icon = a.direction === 'recovered' ? TrendingUp : TrendingDown;
            return (
              <TouchableOpacity
                key={a.id}
                style={styles.card}
                onPress={() => router.push({ pathname: '/margin-risk', params: { projectId: a.projectId } } as any)}
                activeOpacity={0.7}
                testID={`margin-alert-${a.projectId}`}
              >
                <View style={[styles.stripe, { backgroundColor: c }]} />
                <View style={styles.cardBody}>
                  <View style={styles.cardTopline}>
                    <View style={[styles.sevPill, { backgroundColor: c + '1F' }]}>
                      <Icon size={11} color={c} />
                      <Text style={[styles.sevText, { color: c }]}>{severityLabel(a.severity)}</Text>
                    </View>
                    <View style={[styles.scorePill, { backgroundColor: c + '14' }]}>
                      <Text style={[styles.scoreText, { color: c }]}>{a.score}</Text>
                    </View>
                  </View>
                  <Text style={styles.cardTitle} numberOfLines={2}>{a.title}</Text>
                  <Text style={styles.cardDetail} numberOfLines={3}>{a.detail}</Text>
                  <View style={styles.metaLine}>
                    <Text style={[styles.metaVal, { color: a.marginPct < 0.1 ? t.danger : t.textSecondary }]}>{pct(a.marginPct)} margin</Text>
                    {a.erosionPoints < -0.05 && (
                      <>
                        <Text style={styles.metaDot}>·</Text>
                        <TrendingDown size={11} color={t.danger} />
                        <Text style={[styles.metaVal, { color: t.danger }]}>{a.erosionPoints.toFixed(1)} pts off bid</Text>
                      </>
                    )}
                  </View>
                </View>
                <ChevronRight size={18} color={t.textMuted} />
              </TouchableOpacity>
            );
          })}

          <Text style={styles.note}>
            Tap a job to drill into its Margin Risk and the Living Estimate behind it.
            {Platform.OS !== 'web' ? ' New high-risk crossings also push a notification.' : ''}
            {' '}Mark all read to clear — an unread alert sticks around until you do.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerBtn: { width: 38, height: 38, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerText: { flex: 1 },
  headerEyebrow: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, letterSpacing: 0.4 },
  headerTitle: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text },

  summary: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, padding: 12, marginBottom: 14,
  },
  summaryText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  summaryStrong: { fontWeight: '800' as const, color: t.danger },

  card: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, paddingRight: 12, marginBottom: 10,
    overflow: 'hidden' as const,
  },
  stripe: { width: 4, alignSelf: 'stretch' as const },
  cardBody: { flex: 1, paddingVertical: 12, gap: 5 },
  cardTopline: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  sevPill: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.sm,
  },
  sevText: { fontSize: Type.caption2.fontSize, fontWeight: '800' as const, letterSpacing: 0.3 },
  scorePill: {
    minWidth: 30, paddingHorizontal: 7, paddingVertical: 3, borderRadius: Tokens.radius.sm,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  scoreText: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const },
  cardTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  cardDetail: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },
  metaLine: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, flexWrap: 'wrap' as const, marginTop: 1 },
  metaVal: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  metaDot: { fontSize: Type.caption1.fontSize, color: t.textMuted },

  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 8 },
});
