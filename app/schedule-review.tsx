// schedule-review.tsx — review-and-refine step for the AI draft schedule.
//
// generative-setup stashes an AutoScheduleResult via stashDraft(); this screen
// takes it once on mount, shows the draft grouped by phase with each task's
// rationale (and an assumption flag when the AI guessed), lets the GC
// regenerate any single phase, and only commits to the project when the GC taps
// "Use this schedule". Nothing is written to the project until then.

import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, Alert, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Sparkles, AlertTriangle, RefreshCcw, Check } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import EmptyState from '@/components/EmptyState';
import { takeDraft, generateScheduleFromEstimate } from '@/utils/autoScheduleFromEstimate';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { buildScheduleFromTasks } from '@/utils/scheduleEngine';
import { SCHEDULE_PHASES } from '@/utils/scheduleGenSchema';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { ScheduleTask } from '@/types';
import { buildPaceBook, lookupPace, suggestDuration } from '@/utils/pace/paceBook';
import { buildPaceFacts } from '@/utils/copilot/scheduleBuilder/paceGrounding';
import { tradeKeyForTask } from '@/utils/scheduleColors';
import PaceChip from '@/components/schedule/PaceChip';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';

// The theme has no `warning` key; the assumption flag uses this amber literal.
const ASSUMPTION_COLOR = '#c47f17';

// Schedule Pro (the drag/CPM grid) only renders above this width and is Pro-gated.
// Below it — or below Pro — send the GC to the classic schedule instead of
// bouncing them into a paywall/empty grid after they accept the draft.
const GRID_BREAKPOINT = 900;

export default function ScheduleReviewScreen() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { getProject, updateProject, projects } = useProjects();
  const { tier } = useSubscription();
  const { width } = useWindowDimensions();
  const { canAccess } = useTierAccess();
  const { isDesktop } = useResponsiveLayout();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);

  const [draft] = useState(() => takeDraft());
  const [tasks, setTasks] = useState<ScheduleTask[]>(draft?.tasks ?? []);
  const [regenerating, setRegenerating] = useState(false);

  const canRegenerate = !!project?.linkedEstimate;

  const byPhase = useMemo(() => {
    const m = new Map<string, ScheduleTask[]>();
    tasks.forEach(task => {
      const k = task.phase || 'General';
      m.set(k, [...(m.get(k) ?? []), task]);
    });
    // Sort phases into canonical SCHEDULE_PHASES order; unknown phases sort last.
    const order = (phase: string) => {
      const idx = (SCHEDULE_PHASES as readonly string[]).indexOf(phase);
      return idx === -1 ? SCHEDULE_PHASES.length : idx;
    };
    return Array.from(m.entries()).sort((a, b) => order(a[0]) - order(b[0]));
  }, [tasks]);

  const assumptionCount = useMemo(() => tasks.filter(x => x.assumption).length, [tasks]);

  // Your-pace suggestions — the pace book is derived live from ALL projects'
  // captured as-builts (utils/pace/paceBook.ts). paceFor returns null when
  // the book should stay silent: no/low-confidence history, milestone, or
  // agreement with the AI within a day. Silence, not noise.
  const paceBook = useMemo(() => buildPaceBook(projects), [projects]);
  // HONEST provenance for the header: the same fact builder that grounded the
  // generator prompts (paceGrounding). tradeCount > 0 = the draft's durations
  // were paced from real history; 0 = cold start, say so instead of vanishing.
  const paceProvenance = useMemo(() => {
    try {
      return buildPaceFacts(projects);
    } catch {
      return { facts: [], tradeCount: 0 };
    }
  }, [projects]);
  // Tasks whose duration was already set from a pace suggestion this session.
  const [pacedIds, setPacedIds] = useState<Set<string>>(() => new Set());

  const paceFor = useCallback((task: ScheduleTask): { days: number; jobCount: number; confidence: 'medium' | 'high' } | null => {
    if (task.isMilestone || task.durationDays <= 0) return null;
    // Once a suggestion is applied to a task, never re-offer on it — the blend
    // re-anchors to the just-applied value and would spawn an endless chain of
    // fresh suggestions (9 → 10 → 10.6 → …).
    if (pacedIds.has(task.id)) return null;
    // The 'general' fallback trade aggregates unrelated miscellaneous tasks —
    // a pace drawn from it is noise, not history.
    const trade = tradeKeyForTask(task);
    if (trade === 'general') return null;
    const entry = lookupPace(paceBook, trade, project?.squareFootage);
    if (!entry) return null;
    const confidence = entry.confidence;
    if (confidence === 'low') return null;
    const days = suggestDuration(entry, task.durationDays);
    if (Math.abs(days - task.durationDays) < 1) return null;
    return { days, jobCount: entry.jobCount, confidence };
  }, [paceBook, project?.squareFootage, pacedIds]);

  const applyPace = useCallback((taskId: string, days: number) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    // The screen's edit path: accept() rebuilds via buildScheduleFromTasks,
    // whose forward pass reflows dependent startDays from the new duration.
    setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, durationDays: days } : t)));
    setPacedIds(prev => {
      const next = new Set(prev);
      next.add(taskId);
      return next;
    });
  }, []);

  const accept = useCallback(() => {
    if (!project || !draft) return;
    // Rebuild so the persisted schedule's cached task-derived fields
    // (criticalPathDays, healthScore, phases, …) reflect the accepted tasks
    // rather than draft.schedule's values computed from the original draft.
    const rebuilt = buildScheduleFromTasks(
      draft.schedule.name ?? 'Schedule',
      project.id,
      tasks,
      draft.schedule.baseline ?? null,
    );
    // rebuilt.tasks are the REFLOWED tasks (recalculateStartDays ran inside
    // buildScheduleFromTasks) — do NOT override them with this screen's
    // un-reflowed `tasks` state, or an applied pace duration persists without
    // its dependents' startDays moving.
    updateProject(project.id, { schedule: { ...draft.schedule, ...rebuilt } });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // The schedule is committed above regardless; only the destination differs.
    // Schedule Pro needs both a wide viewport and Pro — otherwise land the GC in
    // the classic schedule instead of a paywall/empty grid.
    const wideEnoughForPro = width >= GRID_BREAKPOINT && canAccess('schedule_gantt_pdf');
    if (wideEnoughForPro) {
      router.replace({ pathname: '/schedule-pro', params: { projectId: project.id } } as any);
    } else {
      router.replace({ pathname: '/(tabs)/schedule', params: { projectId: project.id } } as any);
    }
  }, [project, draft, tasks, updateProject, router, width, canAccess]);

  // Whole-draft regenerate — re-runs generation and replaces the ENTIRE draft.
  // A per-phase splice was broken: fresh ids dangle every retained/injected
  // dependency link across phases, silently losing sequencing.
  const regenerate = useCallback(async () => {
    if (!project?.linkedEstimate || regenerating) return;
    const limit = await checkAILimit(tier, 'smart', 'scheduleBuilder');
    if (!limit.allowed) {
      showAILimitAlert({ limit, router });
      return;
    }
    setRegenerating(true);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const fresh = await generateScheduleFromEstimate(project, project.linkedEstimate, projects);
      if (fresh.tasks.length === 0) {
        Alert.alert('Couldn\'t regenerate', 'The generator returned no tasks. Your current draft is unchanged.');
        return;
      }
      setTasks(fresh.tasks);
      await recordAIUsage('smart', 'scheduleBuilder');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong while regenerating the schedule.';
      Alert.alert('Couldn\'t regenerate', message);
    } finally {
      setRegenerating(false);
    }
  }, [project, regenerating, tier, router, projects]);

  // Empty state — nothing was stashed (deep link / reload).
  if (!draft) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.headerEyebrow}>Review schedule · MAGE</Text>
            <Text style={styles.headerTitle} numberOfLines={1}>Draft schedule</Text>
          </View>
          <View style={styles.headerBtn} />
        </View>
        <EmptyState
          icon={<Sparkles size={36} color={t.accent} strokeWidth={1.6} />}
          title="No draft to review"
          message="Generate a draft schedule from Generative Setup, then come back here to review it before applying."
          actionLabel="Go back"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Review schedule · MAGE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{project?.name ?? 'Draft schedule'}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={[{ padding: 16, paddingBottom: 120 + insets.bottom }, isDesktop && styles.contentDesktop]} showsVerticalScrollIndicator={false}>
        <View style={styles.summaryRow}>
          <Sparkles size={16} color={t.accent} strokeWidth={1.75} />
          <Text style={styles.summaryText}>
            {tasks.length} task{tasks.length === 1 ? '' : 's'} across {byPhase.length} phase{byPhase.length === 1 ? '' : 's'}
            {assumptionCount > 0 ? ` · ${assumptionCount} assumption${assumptionCount === 1 ? '' : 's'} to confirm` : ''}
          </Text>
        </View>

        {paceProvenance.tradeCount > 0 ? (
          <View style={styles.pacedChip}>
            <Text style={styles.pacedChipText}>
              Paced from your history · {paceProvenance.tradeCount} trade{paceProvenance.tradeCount === 1 ? '' : 's'}
            </Text>
          </View>
        ) : (
          <Text style={styles.paceColdStart}>
            Durations are AI estimates — MAGE learns your real pace as you finish tasks.
          </Text>
        )}

        {byPhase.map(([phase, phaseTasks]) => {
          return (
            <View key={phase} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{phase}</Text>
                  <Text style={styles.cardSub}>{phaseTasks.length} task{phaseTasks.length === 1 ? '' : 's'}</Text>
                </View>
              </View>

              <View style={styles.cardBody}>
                {phaseTasks.map(task => {
                  const pace = paceFor(task);
                  return (
                    <View key={task.id} style={styles.taskRow}>
                      <View style={styles.taskTitleRow}>
                        <Text style={styles.taskTitle} numberOfLines={2}>{task.title}</Text>
                        {task.assumption && (
                          <View style={styles.assumptionChip}>
                            <AlertTriangle size={11} color={ASSUMPTION_COLOR} strokeWidth={2} />
                            <Text style={styles.assumptionText}>assumed</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.taskMeta}>
                        {task.durationDays}d · crew {task.crewSize ?? '—'}
                      </Text>
                      {pace && (
                        <PaceChip
                          suggestedDays={pace.days}
                          jobCount={pace.jobCount}
                          confidence={pace.confidence}
                          onApply={() => applyPace(task.id, pace.days)}
                        />
                      )}
                      {task.rationale ? (
                        <Text style={styles.taskRationale}>{task.rationale}</Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.footerRow}>
          {canRegenerate && (
            <TouchableOpacity
              style={[styles.regenBtn, regenerating && styles.regenBtnBusy]}
              onPress={regenerate}
              disabled={regenerating}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Regenerate schedule"
            >
              {regenerating ? (
                <>
                  <ActivityIndicator size="small" color={t.accent} />
                  <Text style={styles.regenText}>Regenerating…</Text>
                </>
              ) : (
                <>
                  <RefreshCcw size={15} color={t.accent} strokeWidth={2} />
                  <Text style={styles.regenText}>Regenerate</Text>
                </>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.cta, (!project || regenerating) && styles.ctaDisabled]}
            onPress={accept}
            disabled={!project || regenerating}
            activeOpacity={0.85}
            testID="accept-schedule"
            accessibilityRole="button"
            accessibilityLabel="Use this schedule"
          >
            <Check size={17} color={Colors.textOnAccent} strokeWidth={2.5} />
            <Text style={styles.ctaText}>Use this schedule</Text>
          </TouchableOpacity>
        </View>
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
  headerTitle: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text },

  summaryRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 8,
  },
  summaryText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19 },

  // Pace-provenance chip — mirrors the estimate wizard's groundedChip
  // (app/estimate-wizard.tsx:1357) so grounded AI surfaces read the same.
  pacedChip: {
    alignSelf: 'flex-start' as const, backgroundColor: t.successSoft, borderRadius: Tokens.radius.full,
    paddingHorizontal: 12, paddingVertical: 5, marginBottom: 16,
  },
  pacedChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.success },
  paceColdStart: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginBottom: 16 },

  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 16, marginBottom: 12,
  },
  cardHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  cardTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  cardSub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 2 },

  regenBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
    paddingHorizontal: 14, paddingVertical: 15, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.accentSoft, backgroundColor: t.accentSoft,
  },
  regenBtnBusy: { opacity: 0.7 },
  regenText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.accent },

  cardBody: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.line, gap: 14 },

  taskRow: { gap: 3 },
  taskTitleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  taskTitle: { flexShrink: 1, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text },
  taskMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' as const },
  taskRationale: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontStyle: 'italic' as const, lineHeight: 17, marginTop: 1 },

  assumptionChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: Tokens.radius.full,
    backgroundColor: 'rgba(196,127,23,0.12)',
  },
  assumptionText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: ASSUMPTION_COLOR, letterSpacing: 0.2 },

  footer: {
    position: 'absolute' as const, left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12, backgroundColor: t.bg,
    borderTopWidth: 1, borderTopColor: t.line,
  },
  footerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  cta: {
    flex: 1,
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8, backgroundColor: t.accent, borderRadius: Tokens.radius.card, paddingVertical: 16,
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },
  contentDesktop: { width: '100%', maxWidth: 760, alignSelf: 'center' as const },
});
