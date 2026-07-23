// app/judges.tsx — JUDGES Bid Advisor screen.
//
// Business-gated. Two paths:
//   Describe: type a scope description + compact project-type / size / quality
//             / timeline inputs → AI drafts lines via draftLinesFromScope →
//             runJudges computes a verdict.
//   Pick existing: list projects with a linkedEstimate → tap to map items to
//             JudgesLines → runJudges with the full project context (enables
//             marginRisk calibration).
//
// Anti-slop: no raw hex, no inline fontSize, no numeric borderRadius.
// All color references are semantic ThemeColors or Colors.*; text via Type.*;
// spacing via Tokens.spacing.*; radius via Tokens.radius.*.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Scale, List } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Colors } from '@/constants/colors';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useProjects } from '@/contexts/ProjectContext';
import { VerdictCard } from '@/components/judges/VerdictCard';
import { draftLinesFromScope, runJudges } from '@/utils/judges/runJudges';
import type { JudgesResult } from '@/utils/judges/runJudges';
import type { JudgesLine } from '@/utils/judges/types';
import { PROJECT_TYPES } from '@/types';
import type { ProjectType } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { WizardAnswers } from '@/utils/scopeQuestions';

// ── Business gate ─────────────────────────────────────────────────────
export default function JudgesScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('bid_scoring')) {
    return (
      <Paywall
        visible={true}
        feature="Bid Advisor"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <JudgesInner />;
}

type Mode = 'describe' | 'pick';

function JudgesInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, commitments, changeOrders, invoices } = useProjects();

  // ── Entry mode ────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('describe');

  // ── Describe-mode state ───────────────────────────────────────────────
  const [scope, setScope] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('renovation');
  const [sizeSqft, setSizeSqft] = useState('');
  const [quality, setQuality] = useState<WizardAnswers['quality']>('standard');
  const [timelineWeeks, setTimelineWeeks] = useState('');

  // ── Shared state ──────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JudgesResult | null>(null);

  // ── Context object ────────────────────────────────────────────────────
  const ctx = useMemo(
    () => ({ projects, commitments, changeOrders, invoices }),
    [projects, commitments, changeOrders, invoices],
  );

  // ── Timeline window builder ───────────────────────────────────────────
  function buildTimelineWindow(weeksStr: string): { startISO: string; endISO: string } | undefined {
    const weeks = parseInt(weeksStr, 10);
    if (!Number.isFinite(weeks) || weeks <= 0) return undefined;
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + weeks * 7);
    const toISO = (d: Date) => d.toISOString().slice(0, 10);
    return { startISO: toISO(start), endISO: toISO(end) };
  }

  // ── Describe path: draft + judge ─────────────────────────────────────
  const handleDescribeJudge = useCallback(async () => {
    if (!scope.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const answers: WizardAnswers = {
        projectType,
        sizeSqft: sizeSqft.trim(),
        location: '',
        quality,
        scope: scope.trim(),
        timelineWeeks: timelineWeeks.trim(),
        specialRequirements: '',
        targetBudget: '',
      };
      const drafted = await draftLinesFromScope(answers);
      if (!drafted) {
        setError("Couldn't read that scope — add a bit more detail and try again.");
        return;
      }
      const timelineWindow = buildTimelineWindow(timelineWeeks);
      const res = await runJudges({
        lines: drafted.lines,
        projectType,
        timelineWindow,
        targetMargin: 0.2,
        ctx,
        scopeSummary: drafted.summary,
      });
      setResult(res);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — please try again.');
    } finally {
      setLoading(false);
    }
  }, [scope, projectType, sizeSqft, quality, timelineWeeks, ctx]);

  // ── Pick-existing path: map estimate items + judge ────────────────────
  const handlePickProject = useCallback(async (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project?.linkedEstimate) return;
    setLoading(true);
    setError(null);
    setResult(null);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const est = project.linkedEstimate;
      const lines: JudgesLine[] = est.items.map(item => ({
        category: item.category,
        unit: item.unit,
        quantity: item.quantity,
        bidUnit: item.unitPrice,
      }));
      // Derive targetMargin from globalMarkup: m/(1+m) with m = globalMarkup/100
      const m = (est.globalMarkup ?? 0) / 100;
      const targetMargin = m > 0 ? m / (1 + m) : 0.2;
      const timelineWindow = buildTimelineWindow(timelineWeeks);
      const res = await runJudges({
        lines,
        projectType: project.type ?? 'renovation',
        timelineWindow,
        targetMargin,
        project,
        ctx,
      });
      setResult(res);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — please try again.');
    } finally {
      setLoading(false);
    }
  }, [projects, timelineWeeks, ctx]);

  // ── Projects with estimates (pick mode) ──────────────────────────────
  const projectsWithEstimate = useMemo(
    () => projects.filter(p => !!p.linkedEstimate),
    [projects],
  );

  const handleReset = useCallback(() => {
    setResult(null);
    setError(null);
    setScope('');
    setSizeSqft('');
    setTimelineWeeks('');
    setQuality('standard');
    setProjectType('renovation');
  }, []);

  // ── Render result ─────────────────────────────────────────────────────
  if (result) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.headerEyebrow}>Bid Advisor · MAGE</Text>
            <Text style={styles.headerTitle}>Verdict</Text>
          </View>
          <TouchableOpacity onPress={handleReset} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Judge another">
            <Scale size={18} color={t.textSecondary} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>
        <ScrollView
          contentContainerStyle={{ padding: Tokens.spacing.md, paddingBottom: insets.bottom + 80 }}
          showsVerticalScrollIndicator={false}
        >
          <VerdictCard result={result} />
          <TouchableOpacity style={styles.resetBtn} onPress={handleReset} activeOpacity={0.85}>
            <Text style={styles.resetBtnText}>Judge another</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Bid Advisor · MAGE</Text>
          <Text style={styles.headerTitle}>Should I bid this?</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      {/* Mode toggle */}
      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'describe' && styles.modeBtnActive]}
          onPress={() => setMode('describe')}
          activeOpacity={0.8}
        >
          <Scale size={14} color={mode === 'describe' ? Colors.textOnAccent : t.textSecondary} strokeWidth={1.75} />
          <Text style={[styles.modeBtnText, mode === 'describe' && styles.modeBtnTextActive]}>Describe job</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'pick' && styles.modeBtnActive]}
          onPress={() => setMode('pick')}
          activeOpacity={0.8}
        >
          <List size={14} color={mode === 'pick' ? Colors.textOnAccent : t.textSecondary} strokeWidth={1.75} />
          <Text style={[styles.modeBtnText, mode === 'pick' && styles.modeBtnTextActive]}>Pick estimate</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: Tokens.spacing.md, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Error */}
        {error ? (
          <View style={styles.errorWrap}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* ── Describe mode ── */}
        {mode === 'describe' && (
          <>
            <Text style={styles.sectionTitle}>Describe the scope</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={scope}
              onChangeText={setScope}
              placeholder="e.g. Full kitchen remodel — demo to studs, new layout, cabinets, counters, appliances, tile backsplash, plumbing relocated, 200A panel upgrade"
              placeholderTextColor={t.textMuted}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <Text style={styles.sectionTitle}>Project type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {PROJECT_TYPES.map(pt => (
                <TouchableOpacity
                  key={pt.id}
                  style={[styles.chip, projectType === pt.id && styles.chipActive]}
                  onPress={() => setProjectType(pt.id)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, projectType === pt.id && styles.chipTextActive]}>{pt.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.compactRow}>
              <View style={styles.compactCol}>
                <Text style={styles.fieldLabel}>Size (sqft)</Text>
                <TextInput
                  style={styles.input}
                  value={sizeSqft}
                  onChangeText={setSizeSqft}
                  placeholder="e.g. 250"
                  placeholderTextColor={t.textMuted}
                  keyboardType="numeric"
                  inputMode="numeric"
                />
              </View>
              <View style={styles.compactCol}>
                <Text style={styles.fieldLabel}>Timeline (weeks)</Text>
                <TextInput
                  style={styles.input}
                  value={timelineWeeks}
                  onChangeText={setTimelineWeeks}
                  placeholder="e.g. 8"
                  placeholderTextColor={t.textMuted}
                  keyboardType="numeric"
                  inputMode="numeric"
                />
              </View>
            </View>

            <Text style={styles.fieldLabel}>Quality</Text>
            <View style={styles.qualityRow}>
              {(['budget', 'standard', 'high_end'] as WizardAnswers['quality'][]).map(q => (
                <TouchableOpacity
                  key={q}
                  style={[styles.qualityBtn, quality === q && styles.qualityBtnActive]}
                  onPress={() => setQuality(q)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.qualityBtnText, quality === q && styles.qualityBtnTextActive]}>
                    {q === 'budget' ? 'Budget' : q === 'standard' ? 'Standard' : 'High-End'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.judgeBtn, (!scope.trim() || loading) && styles.judgeBtnDisabled]}
              onPress={handleDescribeJudge}
              disabled={!scope.trim() || loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator size="small" color={Colors.textOnAccent} />
                : <Scale size={16} color={Colors.textOnAccent} strokeWidth={2} />
              }
              <Text style={styles.judgeBtnText}>
                {loading ? 'Judging this job…' : 'Judge this job'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Pick-existing mode ── */}
        {mode === 'pick' && (
          <>
            <Text style={styles.sectionTitle}>Pick an estimate to judge</Text>

            {/* Optional timeline for capacity analysis */}
            <Text style={styles.fieldLabel}>Timeline (weeks) — optional, enables capacity check</Text>
            <TextInput
              style={styles.input}
              value={timelineWeeks}
              onChangeText={setTimelineWeeks}
              placeholder="e.g. 8"
              placeholderTextColor={t.textMuted}
              keyboardType="numeric"
              inputMode="numeric"
            />

            {projectsWithEstimate.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>No projects with estimates yet — create an estimate first and come back.</Text>
              </View>
            ) : (
              projectsWithEstimate.map(p => {
                const est = p.linkedEstimate!;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.projectRow, loading && styles.projectRowDisabled]}
                    onPress={() => !loading && void handlePickProject(p.id)}
                    activeOpacity={0.8}
                    disabled={loading}
                  >
                    <View style={styles.projectRowContent}>
                      <Text style={styles.projectRowName} numberOfLines={1}>{p.name}</Text>
                      <Text style={styles.projectRowSub}>
                        {est.items.length} line{est.items.length === 1 ? '' : 's'} · ${Math.round(est.grandTotal).toLocaleString()}
                      </Text>
                    </View>
                    {loading
                      ? <ActivityIndicator size="small" color={t.accent} />
                      : <Scale size={16} color={t.accent} strokeWidth={1.75} />
                    }
                  </TouchableOpacity>
                );
              })
            )}
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

  modeRow: {
    flexDirection: 'row' as const, gap: 8,
    paddingHorizontal: Tokens.spacing.md, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  modeBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const,
    justifyContent: 'center' as const, gap: 6,
    paddingVertical: 9, borderRadius: Tokens.radius.full,
    borderWidth: 1, borderColor: t.line, backgroundColor: t.surface,
  },
  modeBtnActive: { backgroundColor: t.accent, borderColor: t.accent },
  modeBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.textSecondary },
  modeBtnTextActive: { color: Colors.textOnAccent },

  errorWrap: {
    backgroundColor: t.danger + '16', borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.danger + '44',
    padding: 12, marginBottom: 14,
  },
  errorText: { fontSize: Type.footnote.fontSize, color: t.danger, lineHeight: 19 },

  sectionTitle: {
    fontSize: Type.subheadline.fontSize, fontWeight: '700' as const,
    color: t.text, marginBottom: 10, marginTop: 4,
  },
  fieldLabel: {
    fontSize: Type.caption1.fontSize, color: t.textSecondary,
    fontWeight: '700' as const, marginTop: 12, marginBottom: 5,
  },

  input: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.sm,
    borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: Type.subhead.fontSize, color: t.text,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' as const, marginBottom: 6 },

  chipsRow: { gap: 8, paddingBottom: 2 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.line,
    backgroundColor: t.surface,
  },
  chipActive: { backgroundColor: t.accent + '1A', borderColor: t.accent },
  chipText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  chipTextActive: { color: t.accent },

  compactRow: { flexDirection: 'row' as const, gap: 12, marginTop: 12 },
  compactCol: { flex: 1 },

  qualityRow: { flexDirection: 'row' as const, gap: 8, marginBottom: 6 },
  qualityBtn: {
    flex: 1, paddingVertical: 10, borderRadius: Tokens.radius.sm,
    borderWidth: 1, borderColor: t.line, backgroundColor: t.surface,
    alignItems: 'center' as const,
  },
  qualityBtnActive: { backgroundColor: t.accent + '1A', borderColor: t.accent },
  qualityBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  qualityBtnTextActive: { color: t.accent },

  judgeBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    justifyContent: 'center' as const, gap: 8,
    backgroundColor: t.accent, borderRadius: Tokens.radius.card,
    paddingVertical: 14, marginTop: 20,
  },
  judgeBtnDisabled: { opacity: 0.45 },
  judgeBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },

  emptyWrap: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, padding: 16, marginTop: 8,
  },
  emptyText: { fontSize: Type.footnote.fontSize, color: t.textMuted, lineHeight: 19, textAlign: 'center' as const },

  projectRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, padding: 14, marginBottom: 8, gap: 12,
  },
  projectRowDisabled: { opacity: 0.55 },
  projectRowContent: { flex: 1 },
  projectRowName: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  projectRowSub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 2 },

  resetBtn: {
    marginTop: 20, borderRadius: Tokens.radius.full,
    borderWidth: 1.5, borderColor: t.accent,
    paddingVertical: 12, alignItems: 'center' as const,
  },
  resetBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.accent },
});
