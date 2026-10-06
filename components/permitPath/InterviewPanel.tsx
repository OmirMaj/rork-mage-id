// components/permitPath/InterviewPanel.tsx — "Tell us about the job" (lane PPUI, M5).
//
// One question at a time: yes / no / not sure, choice chips, multi-select
// chips, or a year. Every answer redraws the route (the hook rebuilds it and
// calls layoutNext first), and the change is explained for 4 s under the panel.
//
// A PRE-FILL IS A SUGGESTION. "PLUTO lists Park Slope Historic District ·
// PLUTO 24v2" shows with Confirm and Change; nothing is stored until Confirm
// (the hook's confirmPrefill is the only way a pre-fill becomes an answer).
//
// On first open (no answers) the panel sits open above the spine; once there
// are answers it collapses to an "Edit answers (<n>)" row.

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Button, Card } from '@/components/ui';
import type { InterviewAnswer, InterviewAnswers, Question } from '@/utils/permitPath/types';

export interface InterviewPrefill { value: InterviewAnswer['value']; note: string }

export interface InterviewPanelProps {
  /** The visible questions, in order. */
  questions: readonly Question[];
  answers: InterviewAnswers;
  /** Pending suggestions by question id (display only). */
  prefills: Readonly<Record<string, InterviewPrefill>>;
  progress: { answered: number; visible: number };
  collapsed: boolean;
  onToggle: () => void;
  onAnswer: (id: string, value: InterviewAnswer['value']) => void;
  onConfirmPrefill: (id: string) => void;
  /** What the last answer changed on the route (shown for 4 s by the host). */
  explain: readonly string[];
  testID?: string;
}

type T = ReturnType<typeof useT>['t'];

const YNU = ['yes', 'no', 'unsure'] as const;

function ynuLabel(t: T, v: string): string {
  if (v === 'yes') return t('office.permitPath.interview.yes', 'Yes');
  if (v === 'no') return t('office.permitPath.interview.no', 'No');
  return t('office.permitPath.interview.unsure', 'Not sure');
}

/** The words for an answer value ("Yes", "Kitchen or bath, Plumbing", "1931"). */
export function valueLabel(t: T, q: Question, v: InterviewAnswer['value']): string {
  if (q.kind === 'yes_no_unsure' && typeof v === 'string') return ynuLabel(t, v);
  const label = (id: string) => q.choices?.find((c) => c.id === id)?.label ?? id;
  if (Array.isArray(v)) return v.map(label).join(', ');
  if (typeof v === 'string') return label(v);
  return String(v);
}

export function InterviewPanel({
  questions, answers, prefills, progress, collapsed, onToggle, onAnswer, onConfirmPrefill, explain, testID = 'permit-path-interview',
}: InterviewPanelProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors: c } = useTheme();
  const { t, tn } = useT();
  const [cursor, setCursor] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<readonly string[]>([]);
  const [changing, setChanging] = useState<readonly string[]>([]);
  const [multi, setMulti] = useState<readonly string[]>([]);
  const [year, setYear] = useState('');

  const shown = useMemo<Question | null>(() => {
    const byCursor = cursor ? questions.find((q) => q.id === cursor) : undefined;
    if (byCursor) return byCursor;
    return questions.find((q) => !(q.id in answers) && !skipped.includes(q.id)) ?? null;
  }, [cursor, questions, answers, skipped]);
  const index = shown ? questions.findIndex((q) => q.id === shown.id) : questions.length;
  const current = shown ? answers[shown.id] : undefined;
  const shownId = shown?.id ?? null;

  // A fresh question starts from its stored answer (multi and year inputs).
  useEffect(() => {
    const v = shownId ? answers[shownId]?.value : undefined;
    setMulti(Array.isArray(v) ? v : []);
    setYear(typeof v === 'number' ? String(v) : '');
    // Only a change of question resets the inputs, never an answer elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownId]);

  const commit = (id: string, value: InterviewAnswer['value']) => {
    onAnswer(id, value);
    setSkipped((s) => s.filter((x) => x !== id));
    setCursor(null);
  };
  const back = () => {
    const prev = questions[Math.max(0, index - 1)];
    if (prev) setCursor(prev.id);
  };
  const skip = () => {
    if (!shown) return;
    setSkipped((s) => (s.includes(shown.id) ? s : [...s, shown.id]));
    const nextOne = questions.slice(index + 1).find((q) => !(q.id in answers) && !skipped.includes(q.id));
    setCursor(nextOne ? nextOne.id : null);
  };

  const answeredCount = progress.answered;
  const explainLines = explain.length ? (
    <View style={styles.explain} testID={`${testID}-explain`} accessibilityLiveRegion="polite">
      {explain.map((line) => <Text key={line} style={styles.explainText}>{line}</Text>)}
    </View>
  ) : null;

  if (collapsed) {
    return (
      <View>
        <Pressable onPress={onToggle} style={styles.collapsedRow} accessibilityRole="button" testID={`${testID}-edit`}>
          <Text style={styles.collapsedText}>{t('office.permitPath.interview.edit', 'Edit answers ({n})', { n: answeredCount })}</Text>
          <ChevronDown size={18} color={c.textSecondary} />
        </Pressable>
        {explainLines}
      </View>
    );
  }

  const prefill = shown && !(shown.id in answers) && !changing.includes(shown.id) ? prefills[shown.id] : undefined;

  const chip = (key: string, label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.choice, active && styles.choiceActive]}
      testID={`${testID}-choice-${key}`}
    >
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );

  const yearNow = new Date().getFullYear();
  const yearValue = /^\d{4}$/.test(year.trim()) ? Number(year.trim()) : null;
  const yearOk = yearValue !== null && yearValue >= 1600 && yearValue <= yearNow;

  return (
    <View>
      <Card style={styles.card} testID={testID}>
        <View style={styles.head}>
          <Text style={styles.panelHead}>{t('office.permitPath.interview.heading', 'Tell us about the job')}</Text>
          {answeredCount > 0 ? (
            <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={t('office.permitPath.interview.collapse', 'Hide the Questions')} hitSlop={8} testID={`${testID}-collapse`}>
              <ChevronUp size={18} color={c.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        {shown ? (
          <View style={styles.body}>
            <Text style={styles.question} testID={`${testID}-question`}>{shown.text}</Text>
            {shown.help ? <Text style={styles.muted}>{shown.help}</Text> : null}

            {prefill ? (
              <View style={styles.prefill} testID={`${testID}-prefill`}>
                <View style={styles.prefillHead}>
                  <Sparkles size={14} color={c.accentLabel} />
                  <Text style={styles.prefillNote}>{prefill.note}</Text>
                </View>
                <Text style={styles.prefillValue}>{t('office.permitPath.interview.suggested', 'Suggested: {value}', { value: valueLabel(t, shown, prefill.value) })}</Text>
                <View style={styles.actions}>
                  <Button label={t('office.permitPath.interview.confirm', 'Confirm')} size="sm" onPress={() => { onConfirmPrefill(shown.id); setCursor(null); }} testID={`${testID}-prefill-confirm`} />
                  <Button label={t('office.permitPath.interview.change', 'Change')} size="sm" variant="secondary" onPress={() => setChanging((s) => [...s, shown.id])} testID={`${testID}-prefill-change`} />
                </View>
              </View>
            ) : shown.kind === 'yes_no_unsure' ? (
              <View style={styles.choices}>
                {YNU.map((v) => chip(v, ynuLabel(t, v), current?.value === v, () => commit(shown.id, v)))}
              </View>
            ) : shown.kind === 'choice' ? (
              <View style={styles.choices}>
                {(shown.choices ?? []).map((ch) => chip(ch.id, ch.label, current?.value === ch.id, () => commit(shown.id, ch.id)))}
              </View>
            ) : shown.kind === 'multi' ? (
              <View style={styles.body}>
                <View style={styles.choices}>
                  {(shown.choices ?? []).map((ch) => {
                    const on = multi.includes(ch.id);
                    return chip(ch.id, ch.label, on, () => setMulti((m) => (on ? m.filter((x) => x !== ch.id) : [...m, ch.id])));
                  })}
                </View>
                <Button
                  label={t('office.permitPath.interview.save', 'Save')}
                  size="sm"
                  disabled={multi.length === 0}
                  onPress={() => commit(shown.id, [...multi])}
                  containerStyle={styles.alignStart}
                  testID={`${testID}-multi-save`}
                />
                {multi.length === 0 ? <Text style={styles.muted}>{t('office.permitPath.interview.pickOne', 'Pick at least one.')}</Text> : null}
              </View>
            ) : (
              <View style={styles.yearRow}>
                <TextInput
                  value={year}
                  onChangeText={setYear}
                  keyboardType="number-pad"
                  maxLength={4}
                  placeholder={t('office.permitPath.interview.yearPlaceholder', 'Year built')}
                  placeholderTextColor={c.textMuted}
                  style={styles.yearInput}
                  accessibilityLabel={shown.text}
                  testID={`${testID}-year`}
                />
                <Button label={t('office.permitPath.interview.save', 'Save')} size="sm" disabled={!yearOk} onPress={() => yearValue !== null && commit(shown.id, yearValue)} testID={`${testID}-year-save`} />
              </View>
            )}
          </View>
        ) : (
          <Text style={styles.muted} testID={`${testID}-done`}>{t('office.permitPath.interview.allDone', 'That’s every question for now. Change any answer with Back.')}</Text>
        )}

        <View style={styles.foot}>
          <Text style={styles.muted} testID={`${testID}-progress`}>
            {tn('office.permitPath.interview.progress', progress.visible, { one: '{a} of 1 answered', other: '{a} of {count} answered' }, { a: progress.answered })}
          </Text>
          <View style={styles.actions}>
            <Button label={t('office.permitPath.interview.back', 'Back')} size="sm" variant="ghost" disabled={index <= 0} onPress={back} testID={`${testID}-back`} />
            <Button label={t('office.permitPath.interview.skip', 'Skip')} size="sm" variant="ghost" disabled={!shown} onPress={skip} testID={`${testID}-skip`} />
          </View>
        </View>
      </Card>
      {explainLines}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: { marginBottom: 12 },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    panelHead: { ...Type.headline, color: c.text },
    body: { gap: 8, marginTop: 8 },
    question: { ...Type.bodyCompactEmphasized, color: c.text },
    muted: { ...Type.footnote, color: c.textSecondary },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    choice: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: c.line, backgroundColor: c.bg },
    choiceActive: { backgroundColor: c.accentFill, borderColor: c.accentFill },
    choiceText: { ...Type.footnoteEmphasized, color: c.text },
    choiceTextActive: { color: c.surface },
    prefill: { gap: 6, padding: 10, borderRadius: Tokens.radius.md, backgroundColor: c.accentSoft },
    prefillHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    prefillNote: { ...Type.footnoteEmphasized, color: c.accentLabel, flex: 1 },
    prefillValue: { ...Type.footnote, color: c.text },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    alignStart: { alignSelf: 'flex-start' },
    yearRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    yearInput: { ...Type.bodyCompact, color: c.text, minWidth: 110, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: c.line, borderRadius: Tokens.radius.sm, backgroundColor: c.bg },
    foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    collapsedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 12, marginBottom: 12, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: c.line },
    collapsedText: { ...Type.bodyCompactEmphasized, color: c.text },
    explain: { gap: 2, marginTop: -4, marginBottom: 12, paddingHorizontal: 12 },
    explainText: { ...Type.footnote, color: c.accentLabel },
  });
}

export default InterviewPanel;
