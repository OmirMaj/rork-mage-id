// buyout-scope-gap.tsx — audit estimate coverage before you award.
//
// Deterministic core: which estimate dollars are covered by a bid package or a
// signed commitment, which are uncovered (at risk of being missed), which are
// double-covered. Optional AI layer: the adjacent scope each trade typically
// needs that isn't a line item yet. See utils/buyoutScopeGap.

import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ScanSearch, Copy, Boxes,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import {
  computeScopeGaps, analyzeAdjacentScope, type AdjacentScopeItem,
} from '@/utils/buyoutScopeGap';
import { formatMoneyFull } from '@/utils/jobCostEngine';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function BuyoutScopeGapScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return (
      <Paywall
        visible={true}
        feature="Buyout Scope-Gap Audit"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <BuyoutScopeGapInner />;
}

function BuyoutScopeGapInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject, getBidPackagesForProject, getCommitmentsForProject } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const report = useMemo(() => {
    if (!project) return null;
    return computeScopeGaps(
      project,
      projectId ? getBidPackagesForProject(projectId) : [],
      projectId ? getCommitmentsForProject(projectId) : [],
    );
  }, [project, projectId, getBidPackagesForProject, getCommitmentsForProject]);

  const [aiItems, setAiItems] = useState<AdjacentScopeItem[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const handleAnalyze = useCallback(async () => {
    if (!project) return;
    setAiLoading(true);
    setAiError(null);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const res = await analyzeAdjacentScope(project);
      if (!res.success) {
        setAiError(res.error || 'Could not analyze scope.');
        return;
      }
      setAiItems(res.items);
    } finally {
      setAiLoading(false);
    }
  }, [project]);

  if (!project) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Stack.Screen options={{ title: 'Scope-Gap Audit' }} />
        <EmptyState
          icon={<ScanSearch size={36} color={t.accent} strokeWidth={1.6} />}
          title="No project to audit yet"
          message="The scope-gap audit checks your estimate against your buyout packages to find work nobody's covering. To use it:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Build an estimate and break it into buyout packages.',
            'Tap Scope-Gap Audit to find the holes before you award.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  const cov = report?.coveragePct ?? 100;
  const covColor = cov >= 95 ? t.success : cov >= 80 ? t.accent : t.danger;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Scope-Gap Audit · MAGE ID</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{project.name}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} showsVerticalScrollIndicator={false}>
        {!report || !project.linkedEstimate || project.linkedEstimate.items.length === 0 ? (
          <View style={styles.infoCard}>
            <ScanSearch size={26} color={t.accent} strokeWidth={1.7} />
            <Text style={styles.infoTitle}>Build an estimate first</Text>
            <Text style={styles.infoBody}>
              The scope-gap audit compares your estimate line items against your buyout
              packages. This project doesn&apos;t have an estimate yet.
            </Text>
          </View>
        ) : !report.hasStructure ? (
          <View style={styles.infoCard}>
            <Boxes size={26} color={t.accent} strokeWidth={1.7} />
            <Text style={styles.infoTitle}>No buyout to audit yet</Text>
            <Text style={styles.infoBody}>
              There are no bid packages or commitments to check the estimate against. Run
              Generative Setup to break the estimate into packages, then come back to find
              the gaps.
            </Text>
            <TouchableOpacity
              style={styles.infoBtn}
              onPress={() => router.replace({ pathname: '/generative-setup', params: { projectId: project.id } } as any)}
              activeOpacity={0.85}
            >
              <MageAIMark size={15} color={t.accent} />
              <Text style={styles.infoBtnText}>Set up buyout</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Coverage hero */}
            <View style={[styles.hero, { borderColor: covColor }]}>
              <Text style={styles.heroLabel}>Estimate scope covered by buyout</Text>
              <View style={styles.heroRow}>
                <Text style={[styles.heroValue, { color: covColor }]}>{cov}%</Text>
                <View style={{ flex: 1 }} />
                {report.uncoveredBudget > 0 && (
                  <View style={styles.gapPill}>
                    <Text style={styles.gapPillText}>{formatMoneyFull(report.uncoveredBudget)} uncovered</Text>
                  </View>
                )}
              </View>
              <View style={styles.gaugeTrack}>
                <View style={[styles.gaugeFill, { width: `${Math.min(100, cov)}%` as any, backgroundColor: covColor }]} />
              </View>
              <Text style={styles.heroSub}>
                {report.uncoveredItems.length === 0
                  ? 'Every estimate line is in a package or commitment. Clean buyout.'
                  : `${report.uncoveredItems.length} line${report.uncoveredItems.length === 1 ? '' : 's'} (${formatMoneyFull(report.uncoveredBudget)}) sit in no package — assign them before you award.`}
              </Text>
            </View>

            {/* Uncovered scope by division */}
            {report.byDivision.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Uncovered scope</Text>
                {report.byDivision.map(d => (
                  <View key={d.division} style={styles.divCard}>
                    <View style={styles.divHead}>
                      <Text style={styles.divTitle}>{d.title}</Text>
                      <Text style={[styles.divBudget, { color: t.danger }]}>{formatMoneyFull(d.uncoveredBudget)}</Text>
                    </View>
                    {d.uncoveredItems.slice(0, 6).map(it => (
                      <View key={it.materialId} style={styles.itemRow}>
                        <Text style={styles.itemName} numberOfLines={1}>{it.name}</Text>
                        <Text style={styles.itemBudget}>{formatMoneyFull(it.budget)}</Text>
                      </View>
                    ))}
                    {d.uncoveredItems.length > 6 && (
                      <Text style={styles.itemMore}>+{d.uncoveredItems.length - 6} more</Text>
                    )}
                  </View>
                ))}
              </>
            )}

            {/* Overlap warnings */}
            {report.overlapItems.length > 0 && (
              <View style={styles.overlapCard}>
                <View style={styles.overlapHead}>
                  <Copy size={16} color={t.accentHot} strokeWidth={1.75} />
                  <Text style={styles.overlapTitle}>Possible double-buy</Text>
                </View>
                <Text style={styles.overlapSub}>
                  {report.overlapItems.length} line{report.overlapItems.length === 1 ? '' : 's'} appear in more than one package — confirm only one sub is carrying them.
                </Text>
                {report.overlapItems.slice(0, 4).map(it => (
                  <View key={it.materialId} style={styles.itemRow}>
                    <Text style={styles.itemName} numberOfLines={1}>{it.name}</Text>
                    <Text style={[styles.itemBudget, { color: t.accentHot }]}>×{it.packageCount}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* AI adjacency */}
            <Text style={styles.sectionTitle}>Commonly missed by your trades</Text>
            <View style={styles.aiCard}>
              {aiItems == null ? (
                <>
                  <Text style={styles.aiIntro}>
                    Beyond the line items — the adjacent work each trade assumes is excluded
                    (blocking, firestopping, flashing, terminations, cleanup). MAGE flags
                    what GCs commonly eat at buyout.
                  </Text>
                  {aiError && <Text style={styles.aiError}>{aiError}</Text>}
                  <TouchableOpacity
                    style={styles.aiBtn}
                    onPress={handleAnalyze}
                    disabled={aiLoading}
                    activeOpacity={0.85}
                    testID="analyze-adjacent-scope"
                  >
                    {aiLoading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <MageAIMark size={15} color="#fff" />
                        <Text style={styles.aiBtnText}>Find commonly-missed scope</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              ) : aiItems.length === 0 ? (
                <Text style={styles.aiIntro}>No adjacency suggestions came back. Try again later.</Text>
              ) : (
                <View style={{ gap: 12 }}>
                  {aiItems.map((it, i) => (
                    <View key={`${it.item}-${i}`} style={[styles.aiItem, i > 0 && styles.aiItemBorder]}>
                      <View style={styles.aiItemHead}>
                        <Text style={styles.aiItemTitle}>{it.item}</Text>
                        {!!it.trade && <Text style={styles.aiItemTrade}>{it.trade}</Text>}
                      </View>
                      {!!it.why && <Text style={styles.aiItemWhy}>{it.why}</Text>}
                    </View>
                  ))}
                </View>
              )}
            </View>

            <Text style={styles.note}>
              Coverage compares estimate line items to packages and signed commitments via
              their estimate-item links. Items with no link to either are counted as
              uncovered. Adjacency suggestions are AI guidance — verify against your specs.
            </Text>
          </>
        )}
      </ScrollView>
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

  hero: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    padding: 18, borderWidth: 1.5, gap: 10, marginBottom: 18,
  },
  heroLabel: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  heroRow: { flexDirection: 'row' as const, alignItems: 'center' as const },
  heroValue: { fontSize: Type.largeTitle.fontSize, fontWeight: '800' as const, letterSpacing: -1, lineHeight: Type.largeTitle.fontSize },
  gapPill: { backgroundColor: t.danger + '1A', paddingHorizontal: 10, paddingVertical: 5, borderRadius: Tokens.radius.full },
  gapPillText: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const, color: t.danger },
  gaugeTrack: { height: 8, borderRadius: Tokens.radius.full, backgroundColor: t.line, overflow: 'hidden' as const },
  gaugeFill: { height: 8, borderRadius: Tokens.radius.full },
  heroSub: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },

  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10, marginTop: 2 },

  divCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, padding: 14, marginBottom: 10, gap: 6,
  },
  divHead: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  divTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  divBudget: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const },
  itemRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 10, paddingVertical: 2 },
  itemName: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary },
  itemBudget: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  itemMore: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' as const, marginTop: 2 },

  overlapCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.accentHot + '55', padding: 14, marginBottom: 18, gap: 6,
  },
  overlapHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  overlapTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  overlapSub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 16, marginBottom: 4 },

  aiCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 16, marginBottom: 16,
  },
  aiIntro: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19, marginBottom: 12 },
  aiError: { fontSize: Type.footnote.fontSize, color: t.danger, marginBottom: 10 },
  aiBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8, backgroundColor: t.accent, borderRadius: Tokens.radius.card, paddingVertical: 14,
  },
  aiBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },
  aiItem: { gap: 3 },
  aiItemBorder: { borderTopWidth: 1, borderTopColor: t.line, paddingTop: 12 },
  aiItemHead: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 8 },
  aiItemTitle: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  aiItemTrade: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.accent },
  aiItemWhy: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },

  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17 },

  infoCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 24, alignItems: 'center' as const,
    gap: 10, marginTop: 24,
  },
  infoTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text },
  infoBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 20, textAlign: 'center' as const },
  infoBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginTop: 6 },
  infoBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.accent },
});
