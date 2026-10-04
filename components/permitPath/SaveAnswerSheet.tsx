// components/permitPath/SaveAnswerSheet.tsx — "Save answer" (lane PPASK).
//
// After the call or the reply, the GC records what the department said: their
// words, the day (DatePickerModal, shown with formatCalendarDay, never
// hand-formatted), their name and title (optional), how they said it, an
// optional https link, and which questions it answers (all ticked to start).
// One row per save; question_ids holds every ticked id.
//
// Save stays blocked with its reason until the answer is valid ("Add what they
// said"), the VOICE blocked-actions rule. Validation is toRow
// (utils/permitPath/deptAnswers.ts), the zod mirror of the table's checks.
// The row id is fixed when the sheet opens, so a second tap or a retry after
// a failure re-sends the same row instead of making a second one.
//
// Saved answers are private (PLAN F3): the note under Save says so.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { CalendarDays, CheckSquare, Square } from 'lucide-react-native';
import { Button, ChipRail, Sheet } from '@/components/ui';
import DatePickerModal from '@/components/DatePickerModal';
import { type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { newAnswerId, useJurisdictionAnswers } from '@/hooks/useJurisdictionAnswers';
import { formatCalendarDay, todayCalendarDay } from '@/utils/calendarDate';
import {
  ANSWER_CHANNELS, questionTextFor, toRow,
  type AnswerChannel, type SavedDeptAnswer,
} from '@/utils/permitPath/deptAnswers';
import { fillQuestion } from '@/utils/permitPath/askDepartment';
import type { DeptQuestion } from '@/utils/permitPath/types';

export interface SaveAnswerSheetProps {
  visible: boolean;
  onClose: () => void;
  jurisdiction: { key: string; name: string };
  questions: readonly DeptQuestion[];
  projectId: string | null;
  onSaved?: (answer: SavedDeptAnswer) => void;
  /** Fills <scope> in the question texts saved with the answer. */
  scopeLine?: string;
  testID?: string;
}

export function SaveAnswerSheet({
  visible, onClose, jurisdiction, questions, projectId, onSaved, scopeLine = '', testID,
}: SaveAnswerSheetProps) {
  const { t } = useT();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { saveAnswer } = useJurisdictionAnswers(jurisdiction.key);
  const id = (s: string) => (testID ? `${testID}-${s}` : undefined);
  // One literal key per channel (the extractor needs fixed keys).
  const channelLabel = (c: AnswerChannel): string => {
    switch (c) {
      case 'phone': return t('office.permitPath.save.channelPhone', 'Phone');
      case 'email': return t('office.permitPath.save.channelEmail', 'Email');
      case 'counter': return t('office.permitPath.save.channelCounter', 'At the counter');
      case 'website': return t('office.permitPath.save.channelWebsite', 'Website');
      case 'letter': return t('office.permitPath.save.channelLetter', 'Letter');
      case 'other': return t('office.permitPath.save.channelOther', 'Other');
    }
  };

  const [rowId, setRowId] = useState(newAnswerId);
  const [answerText, setAnswerText] = useState('');
  const [answeredOn, setAnsweredOn] = useState(todayCalendarDay);
  const [dateOpen, setDateOpen] = useState(false);
  const [saidByName, setSaidByName] = useState('');
  const [saidByRole, setSaidByRole] = useState('');
  const [channel, setChannel] = useState<AnswerChannel>('phone');
  const [sourceUrl, setSourceUrl] = useState('');
  const [picked, setPicked] = useState<string[]>(() => questions.map((q) => q.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const questionKey = questions.map((q) => q.id).join('|');
  // Each opening is a new answer: a fresh id, today's date, every question ticked.
  useEffect(() => {
    if (!visible) return;
    setRowId(newAnswerId());
    setAnswerText('');
    setAnsweredOn(todayCalendarDay());
    setSaidByName('');
    setSaidByRole('');
    setChannel('phone');
    setSourceUrl('');
    setPicked(questionKey ? questionKey.split('|') : []);
    setError(null);
  }, [visible, questionKey]);

  const toggle = useCallback((qid: string) => {
    setPicked((cur) => (cur.includes(qid) ? cur.filter((x) => x !== qid) : [...cur, qid]));
  }, []);

  const input = useMemo(() => {
    const chosen = questions.filter((q) => picked.includes(q.id));
    return {
      id: rowId,
      jurisdictionKey: jurisdiction.key,
      jurisdictionName: jurisdiction.name,
      questionIds: picked,
      questionText: questionTextFor(chosen.map((q) => fillQuestion(q.text, scopeLine))),
      answerText,
      answeredOn,
      saidByName,
      saidByRole,
      channel,
      sourceUrl,
      projectId,
    };
  }, [questions, picked, rowId, jurisdiction.key, jurisdiction.name, scopeLine, answerText, answeredOn, saidByName, saidByRole, channel, sourceUrl, projectId]);

  const check = useMemo(() => toRow(input, { today: todayCalendarDay() }), [input]);

  const save = useCallback(async () => {
    if (!check.ok || saving) return;
    setSaving(true);
    setError(null);
    const res = await saveAnswer(input);
    setSaving(false);
    if (res.outcome === 'failed' || res.outcome === 'invalid') {
      setError(res.reason);
      return;
    }
    onSaved?.(res.answer);
    onClose();
  }, [check.ok, saving, saveAnswer, input, onSaved, onClose]);

  const linkBad = sourceUrl.trim().length > 0 && !check.ok && check.field === 'sourceUrl';

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      size="form"
      title={t('office.permitPath.save.title', 'Save answer')}
      subtitle={jurisdiction.name}
      dismissible={!saving}
      testID={testID}
      primaryAction={{
        label: t('office.permitPath.save.save', 'Save answer'),
        onPress: () => { void save(); },
        disabled: !check.ok,
        disabledReason: check.ok ? undefined : check.reason,
        loading: saving,
        testID: id('save'),
      }}
    >
      <Text style={styles.label}>{t('office.permitPath.save.what', 'What they said')}</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={answerText}
        onChangeText={setAnswerText}
        multiline
        placeholder={t('office.permitPath.save.whatHint', 'In their words')}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={t('office.permitPath.save.what', 'What they said')}
        testID={id('answer')}
      />

      <Text style={styles.label}>{t('office.permitPath.save.date', 'Date')}</Text>
      <Button
        label={formatCalendarDay(answeredOn)}
        variant="secondary"
        size="sm"
        iconLeft={<CalendarDays size={14} color={colors.text} strokeWidth={2} />}
        onPress={() => setDateOpen(true)}
        containerStyle={styles.start}
        testID={id('date')}
      />

      <Text style={styles.label}>{t('office.permitPath.save.name', 'Their name')}</Text>
      <TextInput
        style={styles.input}
        value={saidByName}
        onChangeText={setSaidByName}
        maxLength={120}
        accessibilityLabel={t('office.permitPath.save.name', 'Their name')}
        testID={id('name')}
      />
      <Text style={styles.label}>{t('office.permitPath.save.role', 'Their title')}</Text>
      <TextInput
        style={styles.input}
        value={saidByRole}
        onChangeText={setSaidByRole}
        maxLength={120}
        placeholder={t('office.permitPath.save.roleHint', 'e.g. plans examiner')}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={t('office.permitPath.save.role', 'Their title')}
        testID={id('role')}
      />

      <Text style={styles.label}>{t('office.permitPath.save.how', 'How')}</Text>
      <ChipRail contentContainerStyle={styles.chips} testID={id('channels')}>
        {ANSWER_CHANNELS.map((c) => {
          const on = c === channel;
          return (
            <Pressable
              key={c}
              onPress={() => setChannel(c)}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              testID={id(`channel-${c}`)}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {channelLabel(c)}
              </Text>
            </Pressable>
          );
        })}
      </ChipRail>

      <Text style={styles.label}>{t('office.permitPath.save.link', 'Link (optional)')}</Text>
      <TextInput
        style={styles.input}
        value={sourceUrl}
        onChangeText={setSourceUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="https://"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={t('office.permitPath.save.link', 'Link (optional)')}
        testID={id('link')}
      />
      {linkBad ? <Text style={styles.error}>{t('office.permitPath.save.linkBad', 'Links start with https://')}</Text> : null}

      <Text style={styles.label}>{t('office.permitPath.save.answers', 'This answers')}</Text>
      {questions.map((q) => {
        const on = picked.includes(q.id);
        const Icon = on ? CheckSquare : Square;
        return (
          <Pressable
            key={q.id}
            onPress={() => toggle(q.id)}
            style={styles.checkRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            testID={id(`q-${q.id}`)}
          >
            <Icon size={18} color={on ? colors.accent : colors.textMuted} strokeWidth={2} />
            <Text style={styles.checkText}>{fillQuestion(q.text, scopeLine)}</Text>
          </Pressable>
        );
      })}

      {error ? <Text style={styles.error} testID={id('error')}>{error}</Text> : null}
      <Text style={styles.meta} testID={id('private')}>
        {t('office.permitPath.save.private', 'Only you can see saved answers.')}
      </Text>

      <DatePickerModal
        visible={dateOpen}
        value={answeredOn}
        onClose={() => setDateOpen(false)}
        onChange={(iso) => { setAnsweredOn(iso.slice(0, 10)); setDateOpen(false); }}
        title={t('office.permitPath.save.dateTitle', 'When did they tell you?')}
      />
    </Sheet>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    label: { ...Type.footnote, color: t.textSecondary, marginTop: 12, marginBottom: 4 },
    input: {
      ...Type.body,
      color: t.text,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.md,
      paddingHorizontal: 12,
      paddingVertical: 8,
      minHeight: 40,
    },
    multiline: { minHeight: 96, textAlignVertical: 'top' },
    start: { alignSelf: 'flex-start' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.full,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    chipOn: { borderColor: t.accent, backgroundColor: t.accentSoft },
    chipText: { ...Type.footnote, color: t.text },
    chipTextOn: { color: t.accentLabel },
    checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6 },
    checkText: { ...Type.body, color: t.text, flex: 1 },
    meta: { ...Type.footnote, color: t.textMuted, marginTop: 12 },
    error: { ...Type.footnote, color: t.danger, marginTop: 6 },
  });

export default SaveAnswerSheet;
