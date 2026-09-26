// EstimateWizardDesktop — the Quick Estimate wizard on ONE page, desktop web
// only (wave 6d, lane P2).
//
// WHY. On the founder's 1,512 px MacBook the wizard's question view spanned
// the whole window: one question, a progress bar and a Back / Next row across
// 1,500 px ("Step 1 of 8" showed six lines on a monitor). Here all eight
// questions sit in one column (604-652 px) between:
//   - an INDEX (Layout.column.index): each step's title and state — Done,
//     Needed (in the danger colour once a Generate was blocked on it) or
//     Optional; a click scrolls the column to that question;
//   - a RAIL (Layout.column.rail), only when it fits (utils/estimateWizardDesktop
//     wizardRailFits): "What the AI will price", a live echo of the answers
//     and the grounding line of the prompt that will be sent — never more than
//     the bundle claims.
//
// Generate is never a silent no-op: blocked, it names the missing answer and
// scrolls to it. Cmd/Ctrl+Enter runs it; Cmd+S is deliberately NOT bound
// (usePrimaryAction would bind both) — Save shortcuts must never spend a
// metered AI run.
//
// The phone never mounts this: app/estimate-wizard.tsx renders it behind
// `isDesktopWeb ? … : <today's stepper>`, and it returns null off desktop.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Check } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { ScopeQuestionStepper } from '@/components/ScopeQuestionStepper';
import { ActionBar, ActionBarReadout } from '@/components/ui/ActionBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useIsDesktop } from '@/components/ui/desktop';
import { Layout, Radius } from '@/constants/designTokens';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useContainerWidth } from '@/hooks/useContainerWidth';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import {
  QUALITY_LABELS, SCOPE_STEPS, stepBlockReason, type WizardAnswers,
} from '@/utils/scopeQuestions';
import { firstBlockedStep, stepStates, wizardRailFits } from '@/utils/estimateWizardDesktop';

export interface EstimateWizardDesktopProps {
  answers: WizardAnswers;
  set: <K extends keyof WizardAnswers>(key: K, value: WizardAnswers[K]) => void;
  onGenerate: () => void;
  loading: boolean;
  generateLabel: string;
  onCancel: () => void;
  cancelLabel: string;
  stepHint: string | null;
  setStepHint: (hint: string | null) => void;
  banners: React.ReactNode;
  /** The grounding chip label for the prompt these answers would send, or
   *  null while unknown. Printed verbatim. */
  groundingLine: string | null;
}

const SCOPE_ECHO_MAX = 160;

/** The rail's echo rows: label + the answer, or null for "Not answered".
 *  Optional answers (timeline, special requirements, budget) appear only when
 *  given. */
function echoRows(a: WizardAnswers): { key: string; label: string; value: string | null }[] {
  const t = (s: string) => s.trim();
  const scope = t(a.scope);
  const rows: { key: string; label: string; value: string | null }[] = [
    { key: 'projectType', label: 'Type', value: t(a.projectType) || null },
    { key: 'sizeSqft', label: 'Size', value: t(a.sizeSqft) ? `${t(a.sizeSqft)} sq ft` : null },
    { key: 'location', label: 'Location', value: t(a.location) || null },
    { key: 'quality', label: 'Quality', value: QUALITY_LABELS[a.quality] ?? null },
    { key: 'scope', label: 'Scope', value: scope ? (scope.length > SCOPE_ECHO_MAX ? `${scope.slice(0, SCOPE_ECHO_MAX)}…` : scope) : null },
  ];
  if (t(a.timelineWeeks)) rows.push({ key: 'timelineWeeks', label: 'Timeline', value: `${t(a.timelineWeeks)} weeks` });
  if (t(a.specialRequirements)) rows.push({ key: 'specialRequirements', label: 'Special', value: t(a.specialRequirements) });
  if (t(a.targetBudget)) rows.push({ key: 'targetBudget', label: 'Budget', value: `$${t(a.targetBudget)}` });
  return rows;
}

export function EstimateWizardDesktop({
  answers, set, onGenerate, loading, generateLabel, onCancel, cancelLabel, stepHint, setStepHint, banners, groundingLine,
}: EstimateWizardDesktopProps) {
  const isDesktop = useIsDesktop();
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { width, onLayout } = useContainerWidth();
  const scrollRef = useRef<ScrollView>(null);
  const questionY = useRef<Record<number, number>>({});
  // Set once a Generate press was blocked: "Needed" rows turn the danger
  // colour from then on, so the index shows what is still missing.
  const [attempted, setAttempted] = useState(false);

  const states = useMemo(() => stepStates(answers), [answers]);
  const blocked = firstBlockedStep(answers);

  const scrollTo = useCallback((i: number) => {
    const y = questionY.current[i];
    if (typeof y === 'number') scrollRef.current?.scrollTo({ y: Math.max(0, y - Layout.gutter), animated: true });
  }, []);

  const runGenerate = useCallback(() => {
    if (loading) return;
    if (blocked >= 0) {
      setAttempted(true);
      setStepHint(stepBlockReason(blocked, answers));
      scrollTo(blocked);
      return;
    }
    onGenerate();
  }, [loading, blocked, answers, setStepHint, scrollTo, onGenerate]);

  // Cmd/Ctrl+Enter only. NOT usePrimaryAction: that also binds Cmd+S, and a
  // Save shortcut must never spend a metered AI run (contract C10 / D5).
  useHotkeys(
    [{ combo: 'mod+enter', handler: runGenerate, label: 'Generate estimate', group: 'This screen' }],
    { scope: 'page' },
  );

  if (!isDesktop) return null;

  const railFits = wizardRailFits(width);

  return (
    <View style={styles.outer} onLayout={onLayout} testID="wizard-desktop">
      <View style={styles.row}>
        {/* INDEX — fixed; the questions scroll beside it. */}
        <View style={styles.index} testID="wizard-index">
          {SCOPE_STEPS.map((s, i) => {
            const state = states[i];
            return (
              <Pressable
                key={s.key}
                onPress={() => scrollTo(i)}
                accessibilityRole="button"
                accessibilityLabel={`${s.title} — ${state === 'done' ? 'done' : state === 'needed' ? 'needed' : 'optional'}`}
                style={({ hovered }) => [styles.indexRow, hovered && styles.indexRowHover]}
                testID={`wizard-index-${s.key}`}
              >
                <Text style={styles.indexLabel} numberOfLines={1}>{s.title}</Text>
                {state === 'done' ? (
                  <View style={styles.indexState}>
                    <Check size={14} color={t.success} strokeWidth={2.25} />
                    <Text style={[styles.indexStateText, { color: t.successLabel }]}>Done</Text>
                  </View>
                ) : (
                  <Text
                    style={[styles.indexStateText, { color: state === 'needed' && attempted ? t.danger : t.textMuted }]}
                  >
                    {state === 'needed' ? 'Needed' : 'Optional'}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>

        {/* QUESTIONS — all eight, one column. */}
        <ScrollView
          ref={scrollRef}
          style={styles.questions}
          contentContainerStyle={styles.questionsContent}
          keyboardShouldPersistTaps="handled"
        >
          {banners}
          {SCOPE_STEPS.map((s, i) => (
            <View
              key={s.key}
              onLayout={(e: LayoutChangeEvent) => { questionY.current[i] = e.nativeEvent.layout.y; }}
              testID={`wizard-q-${s.key}`}
            >
              <ScopeQuestionStepper stepIndex={i} answers={answers} onChange={set} testIDPrefix="wizard" density="compact" />
            </View>
          ))}
        </ScrollView>

        {/* RAIL — what the prompt will carry. Only when it fits. */}
        {railFits ? (
          <View style={styles.rail} testID="wizard-rail">
            <Card>
              <Text style={styles.railHeading}>What the AI will price</Text>
              {echoRows(answers).map((r) => (
                <View key={r.key} style={styles.echoRow}>
                  <Text style={styles.echoLabel}>{r.label}</Text>
                  <Text style={[styles.echoValue, r.value ? null : { color: t.textMuted }]} numberOfLines={4}>
                    {r.value ?? 'Not answered'}
                  </Text>
                </View>
              ))}
              {groundingLine ? <Text style={styles.grounding} testID="wizard-grounding">{groundingLine}</Text> : null}
            </Card>
          </View>
        ) : null}
      </View>

      <ActionBar width="dashboard" style={styles.footer} testID="wizard-desktop-footer">
        <ActionBarReadout>
          {stepHint ? <Text style={styles.hint} testID="wizard-step-hint">{stepHint}</Text> : null}
        </ActionBarReadout>
        <Button label={cancelLabel} variant="secondary" onPress={onCancel} testID="wizard-cancel" />
        <Button
          label={generateLabel}
          onPress={runGenerate}
          loading={loading}
          disabled={loading}
          iconLeft={<MageAIMark size={16} color="#FFF" />}
          testID="wizard-generate"
        />
      </ActionBar>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  outer: {
    flex: 1,
    width: '100%',
    maxWidth: Layout.page.dashboard,
    alignSelf: 'center',
    paddingHorizontal: Layout.gutter,
  },
  row: { flex: 1, flexDirection: 'row', gap: Layout.gutter, minHeight: 0 },
  index: { width: Layout.column.index, paddingTop: Layout.gutter, gap: 2 },
  indexRow: {
    height: Layout.control.row,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    borderRadius: Radius.sm,
  },
  indexRowHover: { backgroundColor: t.surfaceAlt },
  indexLabel: { flex: 1, minWidth: 0, fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },
  indexState: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  indexStateText: { fontSize: Type.caption1.fontSize, fontWeight: '600' },
  questions: { flex: 1 },
  questionsContent: { maxWidth: Layout.page.form, gap: Layout.sectionGap, paddingVertical: Layout.gutter },
  rail: { width: Layout.column.rail, paddingTop: Layout.gutter },
  railHeading: { fontSize: Type.headline.fontSize, fontWeight: '700', color: t.text, marginBottom: Layout.rowGap },
  echoRow: { flexDirection: 'row', gap: 12, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line },
  echoLabel: { width: 72, fontSize: Type.footnote.fontSize, color: t.textMuted },
  echoValue: { flex: 1, minWidth: 0, fontSize: Type.footnote.fontSize, color: t.text },
  grounding: { marginTop: Layout.rowGap, fontSize: Type.caption1.fontSize, color: t.textSecondary },
  footer: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.bg },
  hint: { fontSize: Type.footnote.fontSize, color: t.danger },
});

export default EstimateWizardDesktop;
