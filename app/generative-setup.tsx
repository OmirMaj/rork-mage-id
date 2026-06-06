// generative-setup.tsx — one-tap "turn my estimate into a working project".
//
// Previews the deterministic plan from utils/generativeSetup (buyout packages
// by CSI division + a submittal-log starter) plus an optional AI draft schedule
// (utils/autoScheduleFromEstimate), then applies the chosen pieces through the
// normal ProjectContext adders. The buyout packages are what later give the
// Living Estimate (app/living-estimate) real buyout-variance to track.

import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Boxes, ClipboardCheck, CalendarRange, Check, Sparkles,
  ArrowRight, AlertTriangle,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import {
  buildSetupPlan, packagePlanToBidPackage, submittalPlanToSubmittal,
} from '@/utils/generativeSetup';
import { generateScheduleFromEstimate } from '@/utils/autoScheduleFromEstimate';
import { formatMoneyFull } from '@/utils/jobCostEngine';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function GenerativeSetupScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return (
      <Paywall
        visible={true}
        feature="Generative Project Setup"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <GenerativeSetupInner />;
}

interface ApplyResult {
  packages: number;
  submittals: number;
  scheduleCreated: boolean;
  scheduleError: string | null;
}

function GenerativeSetupInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const {
    getProject, getBidPackagesForProject, getSubmittalsForProject,
    addBidPackage, addSubmittal, updateProject,
  } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const existingPackages = useMemo(
    () => (projectId ? getBidPackagesForProject(projectId) : []),
    [projectId, getBidPackagesForProject],
  );
  const existingSubmittals = useMemo(
    () => (projectId ? getSubmittalsForProject(projectId) : []),
    [projectId, getSubmittalsForProject],
  );
  const hasSchedule = !!project?.schedule && (project.schedule.tasks?.length ?? 0) > 0;

  const plan = useMemo(() => {
    if (!project) return null;
    return buildSetupPlan(project, { existingPackages, existingSubmittals });
  }, [project, existingPackages, existingSubmittals]);

  const [includePackages, setIncludePackages] = useState(true);
  const [includeSubmittals, setIncludeSubmittals] = useState(true);
  const [includeSchedule, setIncludeSchedule] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!project || !plan) return;
    setApplying(true);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    let packages = 0;
    let submittals = 0;
    let scheduleCreated = false;
    let scheduleError: string | null = null;

    try {
      if (includePackages) {
        for (const p of plan.packages) {
          addBidPackage(packagePlanToBidPackage(p, project.id));
          packages += 1;
        }
      }
      if (includeSubmittals) {
        for (const s of plan.submittals) {
          addSubmittal(submittalPlanToSubmittal(s, project.id));
          submittals += 1;
        }
      }
      if (includeSchedule && project.linkedEstimate) {
        try {
          const r = await generateScheduleFromEstimate(project, project.linkedEstimate);
          updateProject(project.id, { schedule: r.schedule });
          scheduleCreated = true;
        } catch (e) {
          scheduleError = e instanceof Error ? e.message : 'Schedule generation failed';
          console.warn('[generative-setup] schedule failed:', scheduleError);
        }
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult({ packages, submittals, scheduleCreated, scheduleError });
    } finally {
      setApplying(false);
    }
  }, [project, plan, includePackages, includeSubmittals, includeSchedule, addBidPackage, addSubmittal, updateProject]);

  if (!project) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Stack.Screen options={{ title: 'Set Up Project' }} />
        <EmptyState
          icon={<Boxes size={36} color={t.accent} strokeWidth={1.6} />}
          title="No project to set up"
          message="Generative Setup turns an estimate into buyout packages, a submittal log, and a draft schedule. To use it:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Build an estimate so there are line items to break out.',
            'Tap Set Up Project to scaffold the rest.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  const hasEstimate = !!project.linkedEstimate && project.linkedEstimate.items.length > 0;
  const nothingToDo =
    (plan?.packages.length ?? 0) === 0 && (plan?.submittals.length ?? 0) === 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Generative Setup · MAGE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{project.name}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 + insets.bottom }} showsVerticalScrollIndicator={false}>
        {result ? (
          <SuccessView
            result={result}
            styles={styles}
            t={t}
            onOpenBuyout={() => router.replace({ pathname: '/buyout', params: { projectId: project.id } } as any)}
            onOpenMargin={() => router.replace({ pathname: '/living-estimate', params: { projectId: project.id } } as any)}
            onDone={() => router.back()}
          />
        ) : !hasEstimate ? (
          <View style={styles.infoCard}>
            <Sparkles size={26} color={t.accent} strokeWidth={1.7} />
            <Text style={styles.infoTitle}>Build an estimate first</Text>
            <Text style={styles.infoBody}>
              Generative Setup breaks your estimate into buyout packages and a submittal
              log. This project doesn&apos;t have an estimate with line items yet.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.lead}>
              Turn your estimate into a working project. MAGE drafts the buyout and a
              submittal log from your line items — all linked back to the estimate, so
              your Living Estimate tracks buyout variance as you award.
            </Text>

            {/* Buyout packages */}
            <SectionCard
              icon={<Boxes size={18} color={t.accent} />}
              title="Buyout packages"
              count={plan?.packages.length ?? 0}
              subtitle={
                (plan?.packages.length ?? 0) > 0
                  ? `${formatMoneyFull(plan?.totalPackagedBudget ?? 0)} across ${plan?.packages.length} CSI division${(plan?.packages.length ?? 0) === 1 ? '' : 's'}`
                  : 'No new divisions to package'
              }
              value={includePackages}
              onValueChange={setIncludePackages}
              disabled={(plan?.packages.length ?? 0) === 0}
              t={t}
              styles={styles}
            >
              {(plan?.packages ?? []).slice(0, 8).map(p => (
                <View key={p.csiDivision} style={styles.previewRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.previewName}>{p.name}</Text>
                    <Text style={styles.previewSub} numberOfLines={1}>{p.scopeDescription}</Text>
                  </View>
                  <Text style={styles.previewVal}>{formatMoneyFull(p.estimateBudget)}</Text>
                </View>
              ))}
              {(plan?.packages.length ?? 0) > 8 && (
                <Text style={styles.previewMore}>+{(plan?.packages.length ?? 0) - 8} more</Text>
              )}
            </SectionCard>

            {/* Submittal log */}
            <SectionCard
              icon={<ClipboardCheck size={18} color={t.info} />}
              title="Submittal log starter"
              count={plan?.submittals.length ?? 0}
              subtitle={
                (plan?.submittals.length ?? 0) > 0
                  ? 'Stubs for divisions that usually need submittals'
                  : 'No submittal-bearing divisions found'
              }
              value={includeSubmittals}
              onValueChange={setIncludeSubmittals}
              disabled={(plan?.submittals.length ?? 0) === 0}
              t={t}
              styles={styles}
            >
              {(plan?.submittals ?? []).map(s => (
                <View key={s.specSection} style={styles.previewRow}>
                  <Text style={[styles.previewName, { flex: 1 }]}>{s.title}</Text>
                  <Text style={styles.previewSub}>Div {s.csiDivision}</Text>
                </View>
              ))}
            </SectionCard>

            {/* Draft schedule */}
            <SectionCard
              icon={<CalendarRange size={18} color={t.success} />}
              title="Draft schedule"
              count={null}
              subtitle={
                hasSchedule
                  ? 'This project already has a schedule — generating replaces it'
                  : 'AI builds a phased schedule from your estimate (~15–35 tasks)'
              }
              value={includeSchedule}
              onValueChange={setIncludeSchedule}
              disabled={false}
              t={t}
              styles={styles}
            >
              {hasSchedule && includeSchedule && (
                <View style={styles.warnRow}>
                  <AlertTriangle size={14} color={t.danger} />
                  <Text style={styles.warnText}>Your current schedule will be overwritten.</Text>
                </View>
              )}
            </SectionCard>

            {plan && (plan.skippedExistingPackages > 0 || plan.uncategorizedItemCount > 0) && (
              <Text style={styles.note}>
                {plan.skippedExistingPackages > 0
                  ? `${plan.skippedExistingPackages} division${plan.skippedExistingPackages === 1 ? '' : 's'} already have a package and were skipped. `
                  : ''}
                {plan.uncategorizedItemCount > 0
                  ? `${plan.uncategorizedItemCount} line item${plan.uncategorizedItemCount === 1 ? '' : 's'} couldn't be classified to a CSI division and landed in a General package.`
                  : ''}
              </Text>
            )}
          </>
        )}
      </ScrollView>

      {!result && hasEstimate && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            style={[styles.cta, (applying || nothingToDo || (!includePackages && !includeSubmittals && !includeSchedule)) && styles.ctaDisabled]}
            onPress={handleGenerate}
            disabled={applying || nothingToDo || (!includePackages && !includeSubmittals && !includeSchedule)}
            activeOpacity={0.85}
            testID="generate-setup"
          >
            {applying ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Sparkles size={17} color="#fff" />
                <Text style={styles.ctaText}>Generate setup</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function SectionCard({
  icon, title, count, subtitle, value, onValueChange, disabled, children, t, styles,
}: {
  icon: React.ReactNode;
  title: string;
  count: number | null;
  subtitle: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled: boolean;
  children?: React.ReactNode;
  t: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={[styles.card, disabled && styles.cardDisabled]}>
      <View style={styles.cardHead}>
        <View style={styles.cardHeadIcon}>{icon}</View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>
            {title}{count != null ? <Text style={styles.cardCount}>  {count}</Text> : null}
          </Text>
          <Text style={styles.cardSub}>{subtitle}</Text>
        </View>
        <Switch
          value={value && !disabled}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ true: t.accent, false: t.line }}
          thumbColor="#fff"
        />
      </View>
      {value && !disabled && children ? <View style={styles.cardBody}>{children}</View> : null}
    </View>
  );
}

function SuccessView({
  result, styles, t, onOpenBuyout, onOpenMargin, onDone,
}: {
  result: ApplyResult;
  styles: ReturnType<typeof makeStyles>;
  t: ThemeColors;
  onOpenBuyout: () => void;
  onOpenMargin: () => void;
  onDone: () => void;
}) {
  return (
    <View style={styles.successWrap}>
      <View style={styles.successIcon}>
        <Check size={30} color="#fff" strokeWidth={2.5} />
      </View>
      <Text style={styles.successTitle}>Project scaffolded</Text>
      <View style={styles.successStats}>
        {result.packages > 0 && (
          <Text style={styles.successStat}>{result.packages} buyout package{result.packages === 1 ? '' : 's'} created</Text>
        )}
        {result.submittals > 0 && (
          <Text style={styles.successStat}>{result.submittals} submittal stub{result.submittals === 1 ? '' : 's'} added</Text>
        )}
        {result.scheduleCreated && <Text style={styles.successStat}>Draft schedule generated</Text>}
        {result.scheduleError && (
          <Text style={[styles.successStat, { color: t.danger }]}>Schedule couldn&apos;t be generated — {result.scheduleError}</Text>
        )}
      </View>

      <TouchableOpacity style={styles.successPrimary} onPress={onOpenBuyout} activeOpacity={0.85}>
        <Text style={styles.successPrimaryText}>Open buyout</Text>
        <ArrowRight size={16} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.successLink} onPress={onOpenMargin} activeOpacity={0.8}>
        <Text style={styles.successLinkText}>See projected margin</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.successLink} onPress={onDone} activeOpacity={0.8}>
        <Text style={[styles.successLinkText, { color: t.textSecondary }]}>Back to project</Text>
      </TouchableOpacity>
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

  lead: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19, marginBottom: 16 },

  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 16, marginBottom: 12,
  },
  cardDisabled: { opacity: 0.55 },
  cardHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  cardHeadIcon: {
    width: 36, height: 36, borderRadius: Tokens.radius.sm,
    backgroundColor: t.bg, alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  cardTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  cardCount: { color: t.accent, fontWeight: '800' as const },
  cardSub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 2, lineHeight: 16 },
  cardBody: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.line, gap: 10 },

  previewRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  previewName: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text },
  previewSub: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 1 },
  previewVal: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  previewMore: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' as const },

  warnRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  warnText: { fontSize: Type.caption1.fontSize, color: t.danger, fontWeight: '600' as const },

  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 4 },

  infoCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 24, alignItems: 'center' as const,
    gap: 10, marginTop: 24,
  },
  infoTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text },
  infoBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 20, textAlign: 'center' as const },

  footer: {
    position: 'absolute' as const, left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12, backgroundColor: t.bg,
    borderTopWidth: 1, borderTopColor: t.line,
  },
  cta: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8, backgroundColor: t.accent, borderRadius: Tokens.radius.card, paddingVertical: 16,
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },

  successWrap: { alignItems: 'center' as const, paddingTop: 32, gap: 10 },
  successIcon: {
    width: 64, height: 64, borderRadius: Tokens.radius.full,
    backgroundColor: t.success, alignItems: 'center' as const, justifyContent: 'center' as const,
    marginBottom: 4,
  },
  successTitle: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text },
  successStats: { alignItems: 'center' as const, gap: 4, marginBottom: 16 },
  successStat: { fontSize: Type.subhead.fontSize, color: t.textSecondary, textAlign: 'center' as const },
  successPrimary: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8, backgroundColor: t.accent, borderRadius: Tokens.radius.card,
    paddingVertical: 14, paddingHorizontal: 28, marginTop: 4,
  },
  successPrimaryText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },
  successLink: { paddingVertical: 10 },
  successLinkText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.accent },
});
