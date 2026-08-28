// margin-risk.tsx — forward-looking margin risk score for one project.
//
// Companion to app/living-estimate: that screen shows what already moved
// margin; this scores how likely the job is to keep bleeding. Reads the same
// project data, runs utils/marginRiskScore, and renders a 0–100 score with the
// ranked risk factors and a recommendation per factor.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { ChevronLeft, ShieldAlert, ArrowRight, Activity } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { computeMarginRisk, riskBandLabel, type RiskBand, type RiskFactor } from '@/utils/marginRiskScore';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

function colorForBand(band: RiskBand, t: ThemeColors): string {
  switch (band) {
    case 'low': return t.success;
    case 'moderate': return t.accent;
    case 'elevated': return t.accentHot;
    case 'high': return t.danger;
  }
}

export default function MarginRiskScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return (
      <Paywall
        visible={true}
        feature="Margin Risk Score"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <MarginRiskInner />;
}

function MarginRiskInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject, changeOrders, commitments, invoices } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const risk = useMemo(() => {
    if (!project) return null;
    return computeMarginRisk({ project, changeOrders, commitments, invoices });
  }, [project, changeOrders, commitments, invoices]);

  if (!project) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Stack.Screen options={{ title: 'Margin Risk' }} />
        <EmptyState
          icon={<ShieldAlert size={36} color={t.accent} strokeWidth={1.6} />}
          title="No project to score yet"
          message="The Margin Risk Score weighs the signals that predict whether a job will bleed margin. To see one:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Build an estimate with markup so there is a margin to protect.',
            'Tap Margin Risk to see the score and what is driving it.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  const band = risk?.band ?? 'low';
  const bandColor = colorForBand(band, t);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Margin Risk · MAGE ID</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{project.name}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} showsVerticalScrollIndicator={false}>
        {!risk?.hasBasis ? (
          <View style={styles.infoCard}>
            <ShieldAlert size={26} color={t.accent} strokeWidth={1.7} />
            <Text style={styles.infoTitle}>No margin to score yet</Text>
            <Text style={styles.infoBody}>
              This project&apos;s estimate doesn&apos;t carry a cost-and-markup split, so there&apos;s
              no bid margin to protect. Apply markup on the estimate and the risk score
              will light up.
            </Text>
          </View>
        ) : (
          <>
            {/* Score hero */}
            <View style={[styles.hero, { borderColor: bandColor }]}>
              <Text style={styles.heroLabel}>Margin risk score</Text>
              <View style={styles.heroScoreRow}>
                <Text style={[styles.heroScore, { color: bandColor }]}>{risk.score}</Text>
                <Text style={styles.heroOutOf}>/ 100</Text>
                <View style={{ flex: 1 }} />
                <View style={[styles.bandChip, { backgroundColor: bandColor + '22' }]}>
                  <Text style={[styles.bandChipText, { color: bandColor }]}>{riskBandLabel(band)}</Text>
                </View>
              </View>
              <View style={styles.gaugeTrack}>
                <View style={[styles.gaugeFill, { width: `${Math.min(100, risk.score)}%` as any, backgroundColor: bandColor }]} />
              </View>
              <Text style={styles.heroSub}>
                {risk.topFactors.length > 0
                  ? `${risk.topFactors.length} factor${risk.topFactors.length === 1 ? '' : 's'} driving risk — act on the top ones below.`
                  : 'No meaningful risk signals right now. Keep buyout and COs tight.'}
              </Text>
            </View>

            {/* Top factors with recommendations */}
            {risk.topFactors.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>What to act on</Text>
                {risk.topFactors.map(f => (
                  <FactorCard key={f.key} f={f} t={t} styles={styles} />
                ))}
              </>
            )}

            {/* Full breakdown */}
            <Text style={styles.sectionTitle}>All factors</Text>
            <View style={styles.breakdownCard}>
              {risk.factors.map((f, i) => {
                const fc = f.risk >= 0.6 ? t.danger : f.risk >= 0.3 ? t.accentHot : f.risk >= 0.15 ? t.accent : t.textMuted;
                return (
                  <View key={f.key} style={[styles.breakdownRow, i > 0 && styles.breakdownBorder]}>
                    <View style={styles.breakdownTop}>
                      <Text style={styles.breakdownLabel}>{f.label}</Text>
                      <Text style={[styles.breakdownPct, { color: fc }]}>{Math.round(f.risk * 100)}</Text>
                    </View>
                    <View style={styles.miniTrack}>
                      <View style={[styles.miniFill, { width: `${Math.round(f.risk * 100)}%` as any, backgroundColor: fc }]} />
                    </View>
                    <Text style={styles.breakdownDetail}>{f.detail}</Text>
                  </View>
                );
              })}
            </View>

            <Text style={styles.note}>
              Score blends seven weighted signals from your estimate, change orders,
              commitments, and invoices. It is a guide, not a guarantee — pair it with the
              Living Estimate for the dollar detail.
            </Text>

            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => router.push({ pathname: '/living-estimate', params: { projectId: project.id } } as any)}
              activeOpacity={0.8}
            >
              <Activity size={16} color={t.accent} strokeWidth={1.75} />
              <Text style={styles.linkRowText}>Open the Living Estimate</Text>
              <ArrowRight size={16} color={t.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function FactorCard({ f, t, styles }: { f: RiskFactor; t: ThemeColors; styles: ReturnType<typeof makeStyles> }) {
  const fc = f.risk >= 0.6 ? t.danger : f.risk >= 0.3 ? t.accentHot : t.accent;
  return (
    <View style={[styles.factorCard, { borderLeftColor: fc }]}>
      <View style={styles.factorHead}>
        <Text style={styles.factorLabel}>{f.label}</Text>
        <Text style={[styles.factorRisk, { color: fc }]}>{Math.round(f.risk * 100)} risk</Text>
      </View>
      <Text style={styles.factorDetail}>{f.detail}</Text>
      <View style={styles.factorRecRow}>
        <ArrowRight size={13} color={t.textSecondary} strokeWidth={1.75} />
        <Text style={styles.factorRec}>{f.recommendation}</Text>
      </View>
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
  headerTitle: { ...Type.serifHeadline, color: t.text },

  hero: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    padding: 18, borderWidth: 1.5, gap: 10, marginBottom: 18,
  },
  heroLabel: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  heroScoreRow: { flexDirection: 'row' as const, alignItems: 'flex-end' as const, gap: 6 },
  heroScore: { fontSize: Type.largeTitle.fontSize, fontWeight: '800' as const, letterSpacing: -1, lineHeight: Type.largeTitle.fontSize },
  heroOutOf: { fontSize: Type.subhead.fontSize, color: t.textMuted, fontWeight: '600' as const, marginBottom: 3 },
  bandChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.full },
  bandChipText: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const },
  gaugeTrack: { height: 8, borderRadius: Tokens.radius.full, backgroundColor: t.line, overflow: 'hidden' as const },
  gaugeFill: { height: 8, borderRadius: Tokens.radius.full },
  heroSub: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },

  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10, marginTop: 2 },

  factorCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, borderLeftWidth: 4,
    padding: 14, marginBottom: 10, gap: 6,
  },
  factorHead: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  factorLabel: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  factorRisk: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const },
  factorDetail: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  factorRecRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 6, marginTop: 2 },
  factorRec: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' as const, lineHeight: 18 },

  breakdownCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, paddingHorizontal: 14, marginBottom: 16,
  },
  breakdownRow: { paddingVertical: 12, gap: 6 },
  breakdownBorder: { borderTopWidth: 1, borderTopColor: t.line },
  breakdownTop: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  breakdownLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text },
  breakdownPct: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const },
  miniTrack: { height: 5, borderRadius: Tokens.radius.full, backgroundColor: t.line, overflow: 'hidden' as const },
  miniFill: { height: 5, borderRadius: Tokens.radius.full },
  breakdownDetail: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 16 },

  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginBottom: 14 },

  linkRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 6, paddingVertical: 14,
  },
  linkRowText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.accent },

  infoCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 24, alignItems: 'center' as const,
    gap: 10, marginTop: 24,
  },
  infoTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text },
  infoBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 20, textAlign: 'center' as const },
});
