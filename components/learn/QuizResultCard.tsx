// components/learn/QuizResultCard.tsx — the end of a skills check: the score,
// the name to print, and what the server said.
//
// HONESTY (spec LEARNQUIZ). The certificate preview renders ONLY for the
// 'issued' phase, and quizReducer reaches 'issued' only from an award whose
// result is { ok: true, passed: true } — the server re-graded the answers and
// wrote the row. A local pass that is offline, refused or still issuing says
// "You passed" and "not issued yet", never "certified". The server's numbers
// replace the local ones whenever the two disagree.
//
// The certificate says it covers using the app (CERT_SCOPE_NOTE) and that the
// name is the one he typed (CERT_NAME_NOTE). It carries no seal, badge or
// stamp: nothing here may read as a trade, safety or license credential.
//
// The buttons (Issue certificate, Try again, …) live in the screen's pinned
// bar; this card is the content above them.

import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { formatDateL } from '@/i18n';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Card } from '@/components/ui/Card';
import { EyebrowLabel } from '@/components/ui/EyebrowLabel';
import { CERT_NAME_NOTE, CERT_SCOPE_NOTE } from '@/utils/learn/types';
import { PASS_PCT } from '@/utils/learn/topics';
import { HOLDER_NAME_MAX, canRetryRefused, type QuizPhase } from '@/utils/learn/quizEngine';

/** Right answers needed out of `total` (integer form of PASS_PCT). */
export function neededToPass(total: number): number {
  return Math.ceil((PASS_PCT * total) / 100);
}

export interface QuizResultCardProps {
  phase: QuizPhase;
  /** The topic's label, e.g. 'Change orders'. */
  label: string;
  holderName: string;
  onChangeName: (name: string) => void;
}

export function QuizResultCard({ phase, label, holderName, onChangeName }: QuizResultCardProps) {
  const { colors } = useTheme();
  const { t } = useT();

  if (phase.kind === 'issued') {
    const c = phase.certificate;
    return (
      <View testID="skills-check-issued">
        <Text style={[Type.title3, { color: colors.text }]} accessibilityRole="header">
          {t('settings.learn.issued', 'Certificate issued: MAGE ID skills: {label}', { label })}
        </Text>
        <Card style={styles.cert} testID="skills-check-certificate">
          <EyebrowLabel tone="neutral" showDot={false}>{t('settings.learn.certEyebrow', 'App skills')}</EyebrowLabel>
          <Text style={[Type.headline, styles.certTitle, { color: colors.text }]}>{`MAGE ID skills: ${label}`}</Text>
          <Text style={[Type.title3, styles.certName, { color: colors.text }]} testID="skills-check-certificate-name">{c.holderName}</Text>
          <Text style={[Type.caption1, { color: colors.textSecondary }]}>{CERT_NAME_NOTE}</Text>
          <View style={[styles.rule, { backgroundColor: colors.line }]} />
          <Text style={[Type.footnote, { color: colors.text }]}>
            {t('settings.learn.certScore', '{correct} of {total} right · Issued {date}', {
              correct: String(c.correct),
              total: String(c.total),
              date: formatDateL(c.issuedAt),
            })}
          </Text>
          <Text style={[Type.footnote, styles.code, { color: colors.textSecondary }]} testID="skills-check-certificate-code">
            {t('settings.learn.certCode', 'Verify code: {code}', { code: c.verifyCode })}
          </Text>
          <Text style={[Type.caption1, styles.scope, { color: colors.textSecondary }]}>{CERT_SCOPE_NOTE}</Text>
        </Card>
      </View>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <View testID={phase.source === 'server' ? 'skills-check-failed-server' : 'skills-check-failed'}>
        <Text style={[Type.title3, { color: colors.text }]} accessibilityRole="header">
          {t('settings.learn.fail', '{correct} of {total} right. You need {need}.', {
            correct: String(phase.correct),
            total: String(phase.total),
            need: String(neededToPass(phase.total)),
          })}
        </Text>
        <Text style={[Type.bodyCompact, styles.sub, { color: colors.textSecondary }]}>
          {t('settings.learn.failSub', 'Practice the tutorial again, or take the check again. The choices come in a new order.')}
        </Text>
      </View>
    );
  }

  if (phase.kind === 'naming' || phase.kind === 'issuing' || phase.kind === 'pending' || phase.kind === 'refused') {
    const editable = phase.kind === 'naming' || (phase.kind === 'refused' && canRetryRefused(phase.reason));
    return (
      <View testID={`skills-check-${phase.kind}`}>
        <Text style={[Type.title3, { color: colors.text }]} accessibilityRole="header">
          {t('settings.learn.pass', 'You passed: {correct} of {total}.', { correct: String(phase.correct), total: String(phase.total) })}
        </Text>

        {phase.kind === 'pending' ? (
          <Text style={[Type.bodyCompact, styles.sub, { color: colors.text }]} testID="skills-check-pending-note">
            {t('settings.learn.offline', "You passed. Your certificate is issued when you're back online.")}
          </Text>
        ) : null}
        {phase.kind === 'refused' ? (
          <Text style={[Type.bodyCompact, styles.sub, { color: colors.warningLabel }]} testID={`skills-check-refused-${phase.reason}`}>
            {phase.reason === 'quiz_changed'
              ? t('settings.learn.quizChanged', 'This check was updated. Take the new version to get your certificate.')
              : phase.reason === 'rate_limited'
                ? t('settings.learn.rateLimited', 'Too many tries for now. Try again in an hour.')
                : phase.reason === 'rejected'
                  ? t('settings.learn.awardRejected', "MAGE ID couldn't issue a certificate with this name. Use 2 to 80 characters and no email address, then try again.")
                  : phase.reason === 'bad_request'
                    ? t('settings.learn.awardBadRequest', "MAGE ID couldn't accept this attempt, so no certificate was issued. Take the check again.")
                    : phase.reason === 'revoked'
                      ? t('settings.learn.awardRevoked', "Your certificate for this check was removed, so it can't be issued again.")
                      : t('settings.learn.awardServer', "Couldn't issue the certificate just now. Your pass is saved on this phone.")}
          </Text>
        ) : null}

        {phase.kind !== 'pending' && !(phase.kind === 'refused' && (phase.reason === 'quiz_changed' || phase.reason === 'bad_request' || phase.reason === 'revoked')) ? (
          <View style={styles.field}>
            <Text style={[Type.footnoteEmphasized, { color: colors.text }]} nativeID="skills-check-name-label">
              {t('settings.learn.nameLabel', 'Name on the certificate')}
            </Text>
            <TextInput
              value={holderName}
              onChangeText={onChangeName}
              editable={editable}
              maxLength={HOLDER_NAME_MAX}
              autoCapitalize="words"
              autoCorrect={false}
              autoComplete="name"
              textContentType="name"
              returnKeyType="done"
              accessibilityLabel={t('settings.learn.nameLabel', 'Name on the certificate')}
              accessibilityLabelledBy="skills-check-name-label"
              placeholderTextColor={colors.textMuted}
              style={[Type.callout, styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt, opacity: editable ? 1 : 0.6 }]}
              testID="skills-check-name"
            />
            <Text style={[Type.caption1, { color: colors.textSecondary }]}>
              {t('settings.learn.nameHelper', 'This is printed on the certificate and shown to anyone you share it with.')}
            </Text>
            <Text style={[Type.caption1, { color: colors.textSecondary }]}>{CERT_NAME_NOTE}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  sub: { marginTop: 8 },
  field: { marginTop: 20, gap: 6 },
  input: {
    minHeight: Tokens.touchTarget.comfortable,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 14,
  },
  cert: { marginTop: 16, gap: 4 },
  certTitle: { marginTop: 6 },
  certName: { marginTop: 12 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  code: { marginTop: 2 },
  scope: { marginTop: 10 },
});

export default QuizResultCard;
