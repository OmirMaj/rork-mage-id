// estimate-review.tsx — AI-powered "did you forget X?" review of a
// project's linked estimate. Equivalent of Buildxact's Blu Estimate
// Reviewer (which they charge +$149/mo for); we ship it bundled.
//
// Flow:
//   1. User taps "Review with AI" from project-detail's Share modal
//      (or any future entry point — it just routes here with a
//      projectId).
//   2. We auto-run the AI review on mount. While it loads we show a
//      skeleton card.
//   3. The result lands as a 4-section breakdown: completeness
//      score + summary, missing trades, missing items, compliance
//      flags. Each item is a card the user can dismiss; future
//      iteration adds an "Apply" button that drops the suggestion
//      into the linked estimate.
//
// Why we don't apply suggestions automatically: pricing is the GC's
// liability. We show the AI's read; the GC decides.

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
  ActivityIndicator, Alert,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Sparkles, AlertTriangle, FileText, ShieldAlert, RefreshCw, Check, X,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { reviewEstimate, type EstimateReviewResult } from '@/utils/estimateReviewer';
import EmptyState from '@/components/ui/EmptyState';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function EstimateReviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject } = useProjects();
  const project = projectId ? getProject(projectId) : null;

  const [result, setResult] = useState<EstimateReviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const runReview = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const r = await reviewEstimate(project);
      setResult(r);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      Alert.alert('Review failed', err instanceof Error ? err.message : 'AI unavailable. Try again.');
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void runReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  if (!project) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Estimate Review' }} />
        <EmptyState
          icon={<FileText size={36} color={Colors.textMuted} strokeWidth={1.6} />}
          title="No project"
          message="Open a project with a linked estimate, then tap Review with AI from the Share menu."
        />
      </View>
    );
  }

  const dismissOne = (key: string) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'AI Review', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.primary, headerTitleStyle: { fontWeight: '700' as const, color: Colors.text } }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
        {/* Hero — completeness score + summary. Only renders when the
            review has finished; the loading state below is skeleton-
            style. */}
        {result && (
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Sparkles size={20} color="#FFFFFF" />
            </View>
            <Text style={styles.heroLabel}>Completeness</Text>
            <Text style={styles.heroScore}>{result.completenessScore}<Text style={styles.heroScoreUnit}> / 100</Text></Text>
            <Text style={styles.heroSummary}>{result.summary}</Text>
            <View style={styles.heroChipRow}>
              <View style={[styles.confidenceChip, result.confidence === 'high' ? styles.confHigh : result.confidence === 'medium' ? styles.confMed : styles.confLow]}>
                <Text style={[styles.confidenceText, { color: result.confidence === 'high' ? Colors.success : result.confidence === 'medium' ? Colors.warning : Colors.error }]}>
                  {result.confidence.toUpperCase()} CONFIDENCE
                </Text>
              </View>
              <TouchableOpacity onPress={runReview} style={styles.refreshChip} accessibilityRole="button" accessibilityLabel="Re-run review">
                <RefreshCw size={11} color={Colors.text} />
                <Text style={styles.refreshChipText}>Re-run</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {loading && !result && (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Reviewing your estimate against industry norms…</Text>
            <Text style={styles.loadingSub}>Usually 5-15 seconds for a typical estimate.</Text>
          </View>
        )}

        {result && (
          <>
            {/* Missing trades — most actionable, render first. */}
            <Section
              title="Missing trades"
              icon={<AlertTriangle size={16} color={Colors.error} />}
              empty="No trades flagged as missing — looks like a complete trade lineup."
              count={result.missingTrades.filter(t => !dismissed.has(`trade:${t.trade}`)).length}
            >
              {result.missingTrades
                .filter(t => !dismissed.has(`trade:${t.trade}`))
                .map((t, i) => (
                  <SuggestionCard
                    key={`trade-${i}`}
                    title={t.trade}
                    body={t.rationale}
                    cost={t.estimatedCost ?? null}
                    tone="error"
                    onDismiss={() => dismissOne(`trade:${t.trade}`)}
                  />
                ))}
            </Section>

            {/* Missing items within trades the model can see. */}
            <Section
              title="Missing items"
              icon={<FileText size={16} color={Colors.warning} />}
              empty="No specific items flagged as missing within your existing trades."
              count={result.missingItems.filter(t => !dismissed.has(`item:${t.item}`)).length}
            >
              {result.missingItems
                .filter(t => !dismissed.has(`item:${t.item}`))
                .map((t, i) => (
                  <SuggestionCard
                    key={`item-${i}`}
                    title={`${t.trade} · ${t.item}`}
                    body={t.rationale}
                    cost={t.estimatedCost ?? null}
                    tone="warning"
                    onDismiss={() => dismissOne(`item:${t.item}`)}
                  />
                ))}
            </Section>

            {/* Pricing sanity flags — the model thinks something looks off. */}
            <Section
              title="Pricing flags"
              icon={<AlertTriangle size={16} color={Colors.info} />}
              empty="Unit costs and quantities look reasonable for the project size."
              count={result.pricingFlags.filter(t => !dismissed.has(`price:${t.itemName}`)).length}
            >
              {result.pricingFlags
                .filter(t => !dismissed.has(`price:${t.itemName}`))
                .map((t, i) => (
                  <SuggestionCard
                    key={`price-${i}`}
                    title={t.itemName}
                    body={`${t.issue}\n\nSuggestion: ${t.suggestion}`}
                    cost={null}
                    tone="info"
                    onDismiss={() => dismissOne(`price:${t.itemName}`)}
                  />
                ))}
            </Section>

            {/* Compliance / process — permits, insurance, OH&P. */}
            <Section
              title="Compliance & process"
              icon={<ShieldAlert size={16} color={Colors.primary} />}
              empty="No compliance gaps detected (permits, insurance allowance, OH&P all look in line)."
              count={result.complianceFlags.filter(t => !dismissed.has(`comp:${t.label}`)).length}
            >
              {result.complianceFlags
                .filter(t => !dismissed.has(`comp:${t.label}`))
                .map((t, i) => (
                  <SuggestionCard
                    key={`comp-${i}`}
                    title={t.label}
                    body={t.detail}
                    cost={null}
                    tone="primary"
                    onDismiss={() => dismissOne(`comp:${t.label}`)}
                  />
                ))}
            </Section>

            <View style={styles.footnote}>
              <AlertTriangle size={11} color={Colors.textMuted} />
              <Text style={styles.footnoteText}>
                AI suggestions are advisory only. The contractor remains responsible for the estimate&apos;s final pricing and scope.
              </Text>
            </View>

            <TouchableOpacity onPress={() => router.back()} style={styles.doneBtn} activeOpacity={0.9}>
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Section({
  title, icon, count, empty, children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.sectionBadge}>
          <Text style={styles.sectionBadgeText}>{count}</Text>
        </View>
      </View>
      {count === 0 ? (
        <View style={styles.emptyCard}>
          <Check size={14} color={Colors.success} />
          <Text style={styles.emptyText}>{empty}</Text>
        </View>
      ) : (
        children
      )}
    </View>
  );
}

function SuggestionCard({
  title, body, cost, tone, onDismiss,
}: {
  title: string;
  body: string;
  cost: number | null;
  tone: 'error' | 'warning' | 'info' | 'primary';
  onDismiss: () => void;
}) {
  const accentColor = tone === 'error' ? Colors.error
    : tone === 'warning' ? Colors.warning
    : tone === 'info' ? Colors.info
    : Colors.primary;
  return (
    <View style={[styles.card, { borderLeftColor: accentColor }]}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{title}</Text>
        <TouchableOpacity onPress={onDismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss">
          <X size={14} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>
      <Text style={styles.cardBody}>{body}</Text>
      {cost != null && cost > 0 && (
        <View style={[styles.costPill, { backgroundColor: accentColor + '14' }]}>
          <Text style={[styles.costPillText, { color: accentColor }]}>≈ {formatMoney(cost)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  hero: {
    margin: Tokens.spacing.md, padding: Tokens.spacing.lg, borderRadius: Tokens.radius.lg,
    backgroundColor: Colors.primary + '0A',
    borderWidth: 1, borderColor: Colors.primary + '25',
    alignItems: 'flex-start' as const,
  },
  heroIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary, alignItems: 'center' as const, justifyContent: 'center' as const },
  heroLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800' as const, color: Colors.primary, letterSpacing: 0.6, textTransform: 'uppercase' as const, marginTop: Tokens.spacing.xs },
  heroScore: { fontSize: 44, fontWeight: '900' as const, color: Colors.text, letterSpacing: -1.4, marginTop: Tokens.spacing.hairline },
  heroScoreUnit: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: Colors.textMuted, letterSpacing: 0 },
  heroSummary: { fontSize: Type.bodyCompact.fontSize, color: Colors.text, marginTop: 6, lineHeight: 22 },
  heroChipRow: { flexDirection: 'row' as const, gap: Tokens.spacing.xs, marginTop: Tokens.spacing.sm },
  confidenceChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Tokens.radius.sm },
  confHigh: { backgroundColor: Colors.success + '14' },
  confMed: { backgroundColor: Colors.warning + '14' },
  confLow: { backgroundColor: Colors.error + '14' },
  confidenceText: { fontSize: 10, fontWeight: '900' as const, letterSpacing: 0.4 },
  refreshChip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: Tokens.radius.sm, backgroundColor: Colors.surfaceAlt },
  refreshChipText: { fontSize: 10, fontWeight: '800' as const, color: Colors.text, letterSpacing: 0.4, textTransform: 'uppercase' as const },

  loadingWrap: { padding: 36, alignItems: 'center' as const, gap: 10 },
  loadingText: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: Colors.text, marginTop: Tokens.spacing.xs, textAlign: 'center' as const },
  loadingSub: { fontSize: Type.footnote.fontSize, color: Colors.textMuted, textAlign: 'center' as const },

  section: { marginHorizontal: Tokens.spacing.md, marginBottom: 18 },
  sectionHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Tokens.spacing.xs, marginBottom: Tokens.spacing.xs },
  sectionTitle: { flex: 1, fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.2 },
  sectionBadge: { paddingHorizontal: Tokens.spacing.xs, paddingVertical: Tokens.spacing.hairline, borderRadius: Tokens.radius.sm, backgroundColor: Colors.fillTertiary, minWidth: 22, alignItems: 'center' as const },
  sectionBadgeText: { fontSize: 11, fontWeight: '800' as const, color: Colors.textMuted },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    padding: Tokens.spacing.sm,
    marginBottom: Tokens.spacing.xs,
    borderWidth: 1, borderColor: Colors.borderLight,
    borderLeftWidth: 4,
  },
  cardHead: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: Tokens.spacing.xs, marginBottom: Tokens.spacing.xxs },
  cardTitle: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const, color: Colors.text },
  cardBody: { fontSize: Type.footnote.fontSize, color: Colors.textSecondary, lineHeight: 19 },
  costPill: { alignSelf: 'flex-start' as const, paddingHorizontal: Tokens.spacing.xs, paddingVertical: 3, borderRadius: Tokens.radius.sm, marginTop: Tokens.spacing.xs },
  costPillText: { fontSize: 11, fontWeight: '800' as const, letterSpacing: 0.2 },

  emptyCard: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Tokens.spacing.xs, padding: Tokens.spacing.sm, borderRadius: Tokens.radius.md, backgroundColor: Colors.success + '0A', borderWidth: 1, borderColor: Colors.success + '25' },
  emptyText: { flex: 1, fontSize: Type.footnote.fontSize, color: Colors.text, lineHeight: 18 },

  footnote: { flexDirection: 'row' as const, gap: 6, alignItems: 'flex-start' as const, paddingHorizontal: 18, paddingVertical: 14, opacity: 0.7 },
  footnoteText: { flex: 1, fontSize: Type.caption2.fontSize, color: Colors.textMuted, lineHeight: 14 },

  doneBtn: { marginHorizontal: Tokens.spacing.md, marginTop: 6, minHeight: 50, borderRadius: 999, backgroundColor: Colors.primary, alignItems: 'center' as const, justifyContent: 'center' as const },
  doneBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: Colors.textOnPrimary, letterSpacing: -0.2 },
});
