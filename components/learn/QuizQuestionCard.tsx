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
// keys). Motion: none of its own. The screen stacks the cards with the motion
// kit's StackPush (app/skills-check.tsx), which moves the card and reads
// Reduce Motion itself.
//
// `decorative`: the same card drawn as a picture of a finished question (the
// card leaving the stack, a card behind). No testIDs, no announcement, choices
// as plain Views (nothing to press), hidden from accessibility: exactly one
// live question card exists at any time.

import React, { useEffect } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { cardSurface } from '@/components/ui/Card';
import type { QuizQuestion } from '@/utils/learn/types';

export interface QuizQuestionCardProps {
  question: QuizQuestion;
  index: number;
  total: number;
  /** The choice he picked, once he has picked (the reveal). */
  pickedId: string | null;
  /** Show the 1–4 key hints (desktop web). */
  showKeys: boolean;
  onPick: (choiceId: string) => void;
  /** A picture of the card (leaving / behind): no testIDs, not pressable, hidden from accessibility. */
  decorative?: boolean;
}

export function QuizQuestionCard({ question, index, total, pickedId, showKeys, onPick, decorative = false }: QuizQuestionCardProps) {
  const { colors } = useTheme();
  const { t } = useT();
  const answered = pickedId !== null;
  const right = answered && pickedId === question.correctId;
  // testIDs only on the live card (a decorative copy would duplicate them).
  const tid = (id: string) => (decorative ? undefined : id);

  useEffect(() => {
    if (!answered || decorative) return;
    AccessibilityInfo.announceForAccessibility(
      `${right ? t('settings.learn.right', 'Right.') : t('settings.learn.wrong', 'Not quite.')} ${question.why}`,
    );
  }, [answered]); // eslint-disable-line react-hooks/exhaustive-deps -- once per reveal

  return (
    <View
      testID={tid('skills-check-question')}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      pointerEvents={decorative ? 'none' : 'auto'}
    >
      <Text style={[Type.footnoteEmphasized, { color: colors.textSecondary }]} testID={tid('skills-check-progress')}>
        {t('settings.learn.questionOf', 'Question {n} of {total}', { n: String(index + 1), total: String(total) })}
      </Text>
      <Text style={[Type.title3, styles.question, { color: colors.text }]} accessibilityRole="header">
        {question.en}
      </Text>

      <View style={styles.choices} accessibilityRole={decorative ? undefined : 'radiogroup'}>
        {question.choices.map((c, i) => {
          const picked = pickedId === c.id;
          const isRight = c.id === question.correctId;
          // After the reveal: his pick shows right or not quite, and the right
          // answer is marked whichever he chose.
          const tone = !answered ? null : isRight ? 'right' : picked ? 'wrong' : null;
          const bg = tone === 'right' ? colors.successSoft : tone === 'wrong' ? colors.warningSoft : colors.surface;
          const border = tone === 'right' ? colors.successLabel : tone === 'wrong' ? colors.warningLabel : colors.line;
          const inner = (
            <>
              {showKeys ? (
                <View style={[styles.key, { borderColor: colors.line }]}>
                  <Text style={[Type.caption1, { color: colors.textSecondary }]}>{String(i + 1)}</Text>
                </View>
              ) : null}
              <Text style={[Type.callout, styles.choiceText, { color: colors.text }]}>{c.en}</Text>
              {tone === 'right' ? <Check size={20} strokeWidth={2} color={colors.successLabel} /> : null}
              {tone === 'wrong' ? <X size={20} strokeWidth={2} color={colors.warningLabel} /> : null}
            </>
          );
          const surface = [
            cardSurface(colors, { radius: 'card', pad: 'none' }),
            styles.choice,
            { backgroundColor: bg, borderColor: border },
          ];
          if (decorative) return <View key={c.id} style={surface}>{inner}</View>;
          return (
            <Pressable
              key={c.id}
              onPress={() => onPick(c.id)}
              disabled={answered}
              accessibilityRole="radio"
              accessibilityState={{ checked: picked, disabled: answered }}
              accessibilityLabel={`${i + 1}. ${c.en}`}
              testID={tid(`skills-check-choice-${c.id}`)}
              style={({ pressed }) => [
                ...surface,
                { opacity: pressed && !answered ? 0.85 : 1 },
              ]}
            >
              {inner}
            </Pressable>
          );
        })}
      </View>

      {answered ? (
        <View style={styles.feedback} testID={tid('skills-check-feedback')}>
          <Text
            style={[Type.bodyCompactEmphasized, { color: right ? colors.successLabel : colors.warningLabel }]}
            testID={tid(right ? 'skills-check-right' : 'skills-check-wrong')}
          >
            {right ? t('settings.learn.right', 'Right.') : t('settings.learn.wrong', 'Not quite.')}
          </Text>
          <Text style={[Type.bodyCompact, styles.why, { color: colors.text }]}>{question.why}</Text>
        </View>
      ) : null}
    </View>
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
