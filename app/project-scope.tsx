// app/project-scope.tsx
//
// Free, project-linked scope capture. Guided stepper (shared with the
// Estimate Wizard via ScopeQuestionStepper + scopeQuestions). Saves
// project.scope; runs NO AI and is NOT paywalled — capture is free, the
// Pro gate lives on AI generation in estimate-wizard.tsx. Reached from
// NextStepHero "Add scope now" (/project-scope?id=<projectId>).

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { Type } from '@/constants/typography';
import { ScopeQuestionStepper } from '@/components/ScopeQuestionStepper';
import {
  INITIAL_SCOPE, TOTAL_SCOPE_STEPS, SCOPE_STEPS, stepCanAdvance, stepBlockReason,
  type WizardAnswers,
} from '@/utils/scopeQuestions';

export default function ProjectScopeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { colors: c } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getProject, updateProject } = useProjects();

  const project = useMemo(() => getProject(id ?? ''), [id, getProject]);

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<WizardAnswers>(INITIAL_SCOPE);
  // Hint shown when the user taps Next while !canAdvance — mirrors the
  // estimate-wizard.tsx pattern (estimate-wizard.tsx:978).
  const [stepHint, setStepHint] = useState<string | null>(null);

  useEffect(() => {
    if (project?.scope) {
      const { updatedAt: _updatedAt, ...rest } = project.scope;
      setAnswers({ ...INITIAL_SCOPE, ...rest });
    }
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear the hint whenever the user changes an answer (mirrors estimate-wizard.tsx:215)
  const onChange = useCallback(<K extends keyof WizardAnswers>(key: K, value: WizardAnswers[K]) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setStepHint(null);
  }, []);

  const persist = useCallback((a: WizardAnswers) => {
    if (!id) return;
    updateProject(id, { scope: { ...a, updatedAt: new Date().toISOString() } });
  }, [id, updateProject]);

  const isLast = step === TOTAL_SCOPE_STEPS - 1;
  const canAdvance = stepCanAdvance(step, answers);
  const stepMeta = SCOPE_STEPS[step];

  const goNext = useCallback(() => {
    if (!canAdvance) {
      // Never a silent dead end — mirror estimate-wizard.tsx:977-979
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setStepHint(stepBlockReason(step, answers));
      return;
    }
    setStepHint(null);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isLast) {
      persist(answers);
      router.back();
      return;
    }
    setStep((s) => Math.min(TOTAL_SCOPE_STEPS - 1, s + 1));
  }, [canAdvance, isLast, answers, step, persist, router]);

  const goBack = useCallback(() => {
    if (step === 0) { router.back(); return; }
    setStep((s) => Math.max(0, s - 1));
  }, [step, router]);

  const skip = useCallback(() => {
    persist(answers);
    router.back();
  }, [answers, persist, router]);

  if (!project) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 40 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.missingTitle}>Project not found</Text>
        <Text style={styles.missingBody}>It may have been deleted. Go back and pick a project.</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
          <Text style={styles.primaryBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} hitSlop={12} testID="scope-back" accessibilityRole="button" accessibilityLabel="Back">
            <ChevronLeft size={24} color={c.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>PROJECT SCOPE</Text>
            <Text style={styles.projName} numberOfLines={1}>{project.name}</Text>
          </View>
          <TouchableOpacity onPress={skip} hitSlop={12} testID="scope-skip" accessibilityRole="button" accessibilityLabel="Skip for now">
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${((step + 1) / TOTAL_SCOPE_STEPS) * 100}%` }]} />
          </View>
          <Text style={styles.progressLabel}>
            Step {step + 1} of {TOTAL_SCOPE_STEPS}{stepMeta?.optional ? ' · optional' : ''}
          </Text>
        </View>

        <ScrollView
          {...fabScroll}
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ScopeQuestionStepper stepIndex={step} answers={answers} onChange={onChange} testIDPrefix="scope" />
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          {stepHint ? (
            <Text style={styles.stepHintText}>{stepHint}</Text>
          ) : null}
          <TouchableOpacity
            style={[styles.nextBtn, !canAdvance && styles.nextBtnDisabled]}
            onPress={goNext}
            activeOpacity={0.85}
            accessibilityState={{ disabled: !canAdvance }}
            testID="scope-next"
          >
            {isLast ? <Check size={18} color="#FFF" strokeWidth={1.75} /> : <ChevronRight size={18} color="#FFF" strokeWidth={1.75} />}
            <Text style={styles.nextBtnText}>{isLast ? 'Save scope' : 'Next'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  eyebrow: { ...Type.caption2, fontWeight: '800' as const, color: c.accent, letterSpacing: 0.8 },
  projName: { ...Type.subhead, fontWeight: '700' as const, color: c.text },
  skipText: { ...Type.footnote, color: c.textSecondary, fontWeight: '600' as const },
  progressWrap: { paddingHorizontal: 20, paddingVertical: 8, gap: 6 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: c.line, overflow: 'hidden' as const },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: c.accent },
  progressLabel: { ...Type.caption1, color: c.textMuted },
  footer: { paddingHorizontal: 20, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line, backgroundColor: c.bg },
  stepHintText: { ...Type.footnote, color: c.danger, textAlign: 'center' as const, marginBottom: 8 },
  nextBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, backgroundColor: c.accent, borderRadius: 14, paddingVertical: 16 },
  nextBtnDisabled: { opacity: 0.4 },
  nextBtnText: { ...Type.bodyEmphasized, color: '#FFF' },
  missingTitle: { ...Type.title3, color: c.text, textAlign: 'center' as const, marginBottom: 6 },
  missingBody: { ...Type.body, color: c.textSecondary, textAlign: 'center' as const, paddingHorizontal: 32, marginBottom: 20 },
  primaryBtn: { alignSelf: 'center' as const, backgroundColor: c.accent, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  primaryBtnText: { ...Type.bodyEmphasized, color: '#FFF' },
});
