// components/learn/QuizQuestionCard.tsx — one skills-check question: the
// question, its choices as large tap rows, and, once he picks, right / not
// quite plus why.
//
// Question and choice text render from the bank data (utils/learn/quizBank),
// never through t(): their catalog ids are for a later i18n phase and a
// non-literal t() key fails scripts/i18n-extract.ts. The chrome around them
// uses literal settings.learn.* keys.
//
// Rows are ≥ 56 pt (Tokens.touchTarget.large). The small number at the left
// of each row is the desktop keyboard hint (1–4 picks; the screen binds the
// keys). Motion: each new question fades and slides in 16 pt on the native
// driver; with Reduce Motion it simply appears.

import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { cardSurface } from '@/components/ui/Card';
import { nativeDriver } from '@/components/ui/motion';
import type { QuizQuestion } from '@/utils/learn/types';

export interface QuizQuestionCardProps {
  question: QuizQuestion;
  index: number;
  total: number;
  /** The choice he picked, once he has picked (the reveal). */
  pickedId: string | null;
  reduceMotion: boolean;
  /** Show the 1–4 key hints (desktop web). */
  showKeys: boolean;
  onPick: (choiceId: string) => void;
}

export function QuizQuestionCard({ question, index, total, pickedId, reduceMotion, showKeys, onPick }: QuizQuestionCardProps) {
  const { colors } = useTheme();
  const { t } = useT();
  const appear = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const answered = pickedId !== null;
  const right = answered && pickedId === question.correctId;

  useEffect(() => {
    if (reduceMotion) { appear.setValue(1); return; }
    appear.setValue(0);
    const a = Animated.timing(appear, { toValue: 1, duration: Tokens.motion.duration.base, useNativeDriver: nativeDriver });
    a.start();
    return () => a.stop();
  }, [index, reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps -- once per question

  useEffect(() => {
    if (!answered) return;
    AccessibilityInfo.announceForAccessibility(
      `${right ? t('settings.learn.right', 'Right.') : t('settings.learn.wrong', 'Not quite.')} ${question.why}`,
    );
  }, [answered]); // eslint-disable-line react-hooks/exhaustive-deps -- once per reveal

  return (
    <Animated.View
      testID="skills-check-question"
      style={{
        opacity: appear,
        transform: [{ translateX: appear.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
      }}
    >
      <Text style={[Type.footnoteEmphasized, { color: colors.textSecondary }]} testID="skills-check-progress">
        {t('settings.learn.questionOf', 'Question {n} of {total}', { n: String(index + 1), total: String(total) })}
      </Text>
      <Text style={[Type.title3, styles.question, { color: colors.text }]} accessibilityRole="header">
        {question.en}
      </Text>

      <View style={styles.choices} accessibilityRole="radiogroup">
        {question.choices.map((c, i) => {
          const picked = pickedId === c.id;
          const isRight = c.id === question.correctId;
          // After the reveal: his pick shows right or not quite, and the right
          // answer is marked whichever he chose.
          const tone = !answered ? null : isRight ? 'right' : picked ? 'wrong' : null;
          const bg = tone === 'right' ? colors.successSoft : tone === 'wrong' ? colors.warningSoft : colors.surface;
          const border = tone === 'right' ? colors.successLabel : tone === 'wrong' ? colors.warningLabel : colors.line;
          return (
            <Pressable
              key={c.id}
              onPress={() => onPick(c.id)}
              disabled={answered}
              accessibilityRole="radio"
              accessibilityState={{ checked: picked, disabled: answered }}
              accessibilityLabel={`${i + 1}. ${c.en}`}
              testID={`skills-check-choice-${c.id}`}
              style={({ pressed }) => [
                cardSurface(colors, { radius: 'card', pad: 'none' }),
                styles.choice,
                { backgroundColor: bg, borderColor: border, opacity: pressed && !answered ? 0.85 : 1 },
              ]}
            >
              {showKeys ? (
                <View style={[styles.key, { borderColor: colors.line }]}>
                  <Text style={[Type.caption1, { color: colors.textSecondary }]}>{String(i + 1)}</Text>
                </View>
              ) : null}
              <Text style={[Type.callout, styles.choiceText, { color: colors.text }]}>{c.en}</Text>
              {tone === 'right' ? <Check size={20} strokeWidth={2} color={colors.successLabel} /> : null}
              {tone === 'wrong' ? <X size={20} strokeWidth={2} color={colors.warningLabel} /> : null}
            </Pressable>
          );
        })}
      </View>

      {answered ? (
        <View style={styles.feedback} testID="skills-check-feedback">
          <Text
            style={[Type.bodyCompactEmphasized, { color: right ? colors.successLabel : colors.warningLabel }]}
            testID={right ? 'skills-check-right' : 'skills-check-wrong'}
          >
            {right ? t('settings.learn.right', 'Right.') : t('settings.learn.wrong', 'Not quite.')}
          </Text>
          <Text style={[Type.bodyCompact, styles.why, { color: colors.text }]}>{question.why}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  question: { marginTop: 6 },
  choices: { marginTop: 16, gap: 10 },
  choice: {
    minHeight: Tokens.touchTarget.large,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  key: {
    width: 24,
    height: 24,
    borderRadius: Tokens.radius.xs,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: { flex: 1 },
  feedback: { marginTop: 16, gap: 4 },
  why: { lineHeight: 20 },
});

export default QuizQuestionCard;
