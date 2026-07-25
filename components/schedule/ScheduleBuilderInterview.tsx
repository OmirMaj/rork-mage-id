// components/schedule/ScheduleBuilderInterview.tsx — the AI Schedule Builder.
//
// The AI alternative to the template picker: a sequence of animated question
// cards (one at a time), each grounded in WHY it matters and skippable to a
// sensible default. Answers → generateScheduleFromAnswers → the existing
// schedule-review screen. Built on Colors/Type/Tokens; New-Arch-safe animation
// (opacity + translateY only — never scaleXY).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Animated, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { X, CalendarDays, ChevronRight, Hammer, ArrowRight } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useProjects } from '@/contexts/ProjectContext';
import DatePickerModal from '@/components/DatePickerModal';
import { stashDraft } from '@/utils/autoScheduleFromEstimate';
import { visibleQuestions, defaultAnswers, type ScheduleBuilderAnswers, type QuestionSpec } from '@/utils/copilot/scheduleBuilder/questions';
import { generateScheduleFromAnswers } from '@/utils/copilot/scheduleBuilder/generateScheduleFromAnswers';

const SKIP = Symbol('skip');

export default function ScheduleBuilderInterview({ projectId }: { projectId: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { getProject, updateProject, projects } = useProjects();
  const project = useMemo(() => getProject(projectId) ?? null, [getProject, projectId]);

  const questions = useMemo(() => visibleQuestions(project), [project]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<ScheduleBuilderAnswers>(() => defaultAnswers(project));
  const [phase, setPhase] = useState<'ask' | 'generating' | 'error'>('ask');
  const [entry, setEntry] = useState('');
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const anim = useRef(new Animated.Value(1)).current;
  const q: QuestionSpec | undefined = questions[idx];

  useEffect(() => {
    setEntry('');
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 320, useNativeDriver: true }).start();
  }, [idx, anim]);

  const advance = useCallback(async (value: unknown) => {
    if (!q) return;
    const nextAnswers = value === SKIP ? answers : { ...answers, [q.field]: value };
    if (value !== SKIP) setAnswers(nextAnswers);
    if (idx < questions.length - 1) { setIdx(idx + 1); return; }
    if (!project) { setErrMsg('No project.'); setPhase('error'); return; }
    setPhase('generating');
    try {
      // Thread ALL projects so durations are paced from the contractor's own
      // finished tasks (buildPaceFacts), not invented by the model.
      const result = await generateScheduleFromAnswers(project, nextAnswers, projects);
      stashDraft(result);

      // Writeback: merge scope/sizeSqft/knownRisks captured in this interview
      // back onto project.scope so the next flow (estimate wizard, permit
      // roadmap, copilot) inherits them without re-asking. Don't clobber
      // existing fields the wizard may have set (merge pattern).
      try {
        const now = new Date().toISOString();
        const existingScope = project.scope ?? {};
        const mergedScope = {
          ...existingScope,
          ...(nextAnswers.scope ? { scope: nextAnswers.scope } : {}),
          ...(nextAnswers.sizeSqft != null ? { sizeSqft: String(nextAnswers.sizeSqft) } : {}),
          ...(nextAnswers.knownRisks ? { specialRequirements: nextAnswers.knownRisks } : {}),
          updatedAt: now,
        };
        updateProject(projectId, { scope: mergedScope as NonNullable<typeof project.scope> });
      } catch {
        // Writeback is best-effort — don't block navigation on failure
      }

      router.replace({ pathname: '/schedule-review', params: { projectId } } as never);
    } catch (e) {
      setErrMsg((e as Error).message ?? 'Could not build the schedule.');
      setPhase('error');
    }
  }, [q, answers, idx, questions.length, project, projectId, router, projects, updateProject]);

  const submitEntry = useCallback(() => {
    if (!q) return;
    const raw = entry.trim();
    if (!raw) { advance(SKIP); return; }
    advance(q.kind === 'number' ? (Number(raw.replace(/[^0-9.]/g, '')) || SKIP) : raw);
  }, [q, entry, advance]);

  if (phase === 'generating') {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.buildingTitle}>Building your schedule…</Text>
        <Text style={styles.buildingSub}>Sequencing tasks, sizing durations, wiring dependencies.</Text>
      </View>
    );
  }
  if (phase === 'error') {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.eyebrow}>SOMETHING WENT WRONG</Text>
        <Text style={styles.question}>{errMsg}</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => setPhase('ask')} activeOpacity={0.9}>
          <Text style={styles.primaryBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!q) return null;

  const cardStyle = { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <DatePickerModal
        visible={datePickerOpen}
        value={(answers[q.field] as string) ?? ''}
        allowFuture
        title={q.question}
        onClose={() => setDatePickerOpen(false)}
        onChange={(iso) => { setDatePickerOpen(false); advance(iso); }}
      />

      {/* top bar: brand + progress + close */}
      <View style={styles.topbar}>
        <Text style={styles.brand}>AI&nbsp;SCHEDULE&nbsp;BUILDER</Text>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Close" hitSlop={10} testID="sb-close">
          <X size={20} color={colors.textMuted} strokeWidth={2} />
        </TouchableOpacity>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${((idx + 1) / questions.length) * 100}%` }]} />
      </View>
      <Text style={styles.progressLabel}>{idx + 1} OF {questions.length}</Text>

      <Animated.View style={[styles.card, cardStyle]}>
        <Text style={styles.eyebrow}>{q.eyebrow}</Text>
        <Text style={styles.question}>{q.question}</Text>
        <Text style={styles.subtext}>{q.subtext}</Text>

        {q.kind === 'choice' ? (
          <View style={styles.choices}>
            {q.choices!.map((c, i) => (
              <TouchableOpacity key={i} style={[styles.choice, c.recommended && styles.choiceRec]} onPress={() => advance(c.value)} activeOpacity={0.85} testID={`sb-choice-${i}`}>
                <View style={[styles.radio, c.recommended && styles.radioRec]} />
                <Text style={styles.choiceText}>{c.label}</Text>
                {c.recommended && <Text style={styles.suggested}>SUGGESTED</Text>}
              </TouchableOpacity>
            ))}
          </View>
        ) : q.kind === 'date' ? (
          <TouchableOpacity style={[styles.choice, styles.choiceRec]} onPress={() => setDatePickerOpen(true)} activeOpacity={0.85} testID="sb-date">
            <CalendarDays size={20} color={colors.accent} strokeWidth={2} />
            <Text style={styles.choiceText}>Pick a date</Text>
            <ChevronRight size={18} color={colors.textMuted} strokeWidth={2} />
          </TouchableOpacity>
        ) : (
          <View>
            <TextInput
              style={styles.input}
              value={entry}
              onChangeText={setEntry}
              placeholder={q.placeholder ?? 'Type your answer…'}
              placeholderTextColor={colors.textMuted}
              keyboardType={q.kind === 'number' ? 'numeric' : 'default'}
              returnKeyType="next"
              onSubmitEditing={submitEntry}
              autoFocus
              multiline={q.kind === 'text'}
              testID="sb-input"
            />
            <TouchableOpacity style={styles.primaryBtn} onPress={submitEntry} activeOpacity={0.9} testID="sb-continue">
              {idx === questions.length - 1
                ? <><Hammer size={18} color={Colors.textOnAccent} strokeWidth={2} /><Text style={styles.primaryBtnText}>Build my schedule</Text></>
                : <><Text style={styles.primaryBtnText}>Continue</Text><ArrowRight size={18} color={Colors.textOnAccent} strokeWidth={2} /></>}
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={styles.skip} onPress={() => advance(SKIP)} activeOpacity={0.7} testID="sb-skip">
          <Text style={styles.skipText}>{q.skipLabel}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    center: { alignItems: 'center', justifyContent: 'center', gap: Tokens.spacing.sm, paddingHorizontal: Tokens.spacing.lg },
    topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Tokens.spacing.lg, paddingTop: Tokens.spacing.md, paddingBottom: Tokens.spacing.sm },
    brand: { ...Type.monoEyebrow, color: colors.textSecondary },
    progressTrack: { height: 3, backgroundColor: colors.line, marginHorizontal: Tokens.spacing.lg, borderRadius: Tokens.radius.full, overflow: 'hidden' },
    progressFill: { height: 3, backgroundColor: colors.accent, borderRadius: Tokens.radius.full },
    progressLabel: { ...Type.monoLabel, color: colors.textMuted, marginHorizontal: Tokens.spacing.lg, marginTop: Tokens.spacing.xxs },
    card: { paddingHorizontal: Tokens.spacing.lg, paddingTop: Tokens.spacing.xl, gap: Tokens.spacing.xs },
    eyebrow: { ...Type.monoLabel, color: colors.accent },
    question: { ...Type.serifHeadline, color: colors.text },
    subtext: { ...Type.body, color: colors.textSecondary, marginBottom: Tokens.spacing.md },
    input: { ...Type.body, color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: Tokens.radius.lg, padding: Tokens.spacing.md, minHeight: 56, textAlignVertical: 'top', marginBottom: Tokens.spacing.sm },
    choices: { gap: Tokens.spacing.xs },
    choice: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm, padding: Tokens.spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: Tokens.radius.lg, backgroundColor: colors.surface },
    choiceRec: { borderColor: colors.accent },
    choiceText: { ...Type.subheadEmphasized, color: colors.text, flex: 1 },
    radio: { width: 18, height: 18, borderRadius: Tokens.radius.full, borderWidth: 2, borderColor: colors.line },
    radioRec: { borderColor: colors.accent, backgroundColor: colors.accent },
    suggested: { ...Type.monoLabel, color: colors.accent },
    primaryBtn: { flexDirection: 'row', gap: Tokens.spacing.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderRadius: Tokens.radius.full, paddingVertical: Tokens.spacing.md, marginTop: Tokens.spacing.xs },
    primaryBtnText: { ...Type.subheadEmphasized, color: Colors.textOnAccent },
    skip: { alignItems: 'center', paddingVertical: Tokens.spacing.md, marginTop: Tokens.spacing.xs },
    skipText: { ...Type.footnote, color: colors.textMuted },
    buildingTitle: { ...Type.serifTitle, color: colors.text, marginTop: Tokens.spacing.sm },
    buildingSub: { ...Type.body, color: colors.textSecondary, textAlign: 'center' },
  });
}
