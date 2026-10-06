// components/permitPath/AskDepartmentSheet.tsx — "Ask the department"
// (lane PPASK). Two tabs over one AskDraft (utils/permitPath/askDepartment.ts):
//
//   Email  the To line (an email read off the office's own source, or the note
//          saying why there is none), an editable subject and body, "Open in
//          Mail" (expo-mail-composer, then a mailto: link — web always takes
//          the mailto: path) and "Copy".
//   Call   "Call <office>" as a tel: button when the office's main number is
//          on file (shown as plain text otherwise), the hours, the numbered
//          questions and what to write down. Then "I got an answer".
//
// MAGE SENDS NOTHING. No edge function, no email service, no network call:
// the GC's own mail app or phone does the sending. Structure after
// components/buildingRecord/DraftQuestionButton.tsx (a Sheet from
// @/components/ui). The footer prints where the office's contact facts came
// from, plus NAME_ONLY_BADGE when MAGE has only the office's name.

import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import * as MailComposer from 'expo-mail-composer';
import { Mail, Phone } from 'lucide-react-native';
import { Badge, Button, SegmentedControl, Sheet, cardSurface } from '@/components/ui';
import { type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { copyToClipboard } from '@/utils/clipboard';
import { showAlert } from '@/utils/alert';
import { NAME_ONLY_BADGE } from '@/utils/permitOffices';
import type { AskDraft } from '@/utils/permitPath/askDepartment';

type Tab = 'email' | 'call';

export interface AskDepartmentSheetProps {
  visible: boolean;
  onClose: () => void;
  draft: AskDraft;
  onSaveAnswer: () => void;
  /** "Ask the next <n>": shown when the draft left questions over. */
  onAskNext?: () => void;
  testID?: string;
}

export function AskDepartmentSheet({ visible, onClose, draft, onSaveAnswer, onAskNext, testID }: AskDepartmentSheetProps) {
  const { t } = useT();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [tab, setTab] = useState<Tab>('email');
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const id = (s: string) => (testID ? `${testID}-${s}` : undefined);

  // A new draft (another set of questions) replaces whatever was being edited.
  useEffect(() => {
    setSubject(draft.subject);
    setBody(draft.body);
  }, [draft.subject, draft.body]);

  const openInMail = useCallback(async () => {
    const recipients = draft.to ? [draft.to] : [];
    try {
      if (Platform.OS !== 'web' && (await MailComposer.isAvailableAsync())) {
        await MailComposer.composeAsync({ recipients, subject, body, isHtml: false });
        return;
      }
      const url = `mailto:${recipients.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      await Linking.openURL(url);
    } catch {
      showAlert(
        t('office.permitPath.ask.noMailTitle', 'No Mail App'),
        t('office.permitPath.ask.noMailBody', 'Copy the draft instead and paste it into your email.'),
      );
    }
  }, [draft.to, subject, body, t]);

  const copy = useCallback(async () => {
    const text = `${draft.to ? `To: ${draft.to}\n` : ''}Subject: ${subject}\n\n${body}`;
    const ok = await copyToClipboard(text);
    showAlert(
      ok ? t('office.permitPath.ask.copied', 'Copied') : t('office.permitPath.ask.copyFailed', 'Copy Failed'),
      ok
        ? t('office.permitPath.ask.copiedBody', 'The draft is on your clipboard.')
        : t('office.permitPath.ask.copyFailedBody', 'Select the text and copy it by hand.'),
    );
  }, [draft.to, subject, body, t]);

  const call = useCallback(async () => {
    if (!draft.call.tel) return;
    try {
      await Linking.openURL(draft.call.tel);
    } catch {
      showAlert(
        t('office.permitPath.ask.noPhoneTitle', 'Can’t Place the Call Here'),
        t('office.permitPath.ask.noPhoneBody', 'Dial the number from your phone.'),
      );
    }
  }, [draft.call.tel, t]);

  const hasDraft = subject.trim().length > 0 || body.trim().length > 0;
  const count = draft.questionIds.length;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      size="wide"
      title={t('office.permitPath.ask.title', 'Ask {office}', { office: draft.officeLabel })}
      subtitle={t('office.permitPath.ask.subtitle', 'MAGE doesn’t send it. You do, from your own mail or phone.')}
      testID={testID}
      primaryAction={tab === 'email'
        ? {
          label: t('office.permitPath.ask.openMail', 'Open in Mail'),
          onPress: () => { void openInMail(); },
          disabled: !hasDraft,
          disabledReason: t('office.permitPath.ask.emptyDraft', 'Write the email first.'),
          testID: id('mail'),
        }
        : {
          label: t('office.permitPath.ask.gotAnswer', 'I Got an Answer'),
          onPress: onSaveAnswer,
          testID: id('got-answer'),
        }}
      secondaryAction={tab === 'email'
        ? {
          label: t('office.permitPath.ask.copy', 'Copy'),
          onPress: () => { void copy(); },
          disabled: !hasDraft,
          testID: id('copy'),
        }
        : undefined}
    >
      <SegmentedControl<Tab>
        options={[
          { value: 'email', label: t('office.permitPath.ask.tabEmail', 'Email'), icon: Mail, testID: id('tab-email') },
          { value: 'call', label: t('office.permitPath.ask.tabCall', 'Call'), icon: Phone, testID: id('tab-call') },
        ]}
        value={tab}
        onChange={setTab}
        size="sm"
        accessibilityLabel={t('office.permitPath.ask.tabs', 'Email or Call')}
        testID={id('tabs')}
      />

      {tab === 'email' ? (
        <View testID={id('email')}>
          <View style={styles.routing}>
            {draft.to ? (
              <Text style={styles.routeTo} testID={id('to')}>
                {t('office.permitPath.ask.to', 'To: {email}', { email: draft.to })}
              </Text>
            ) : null}
            <Text style={draft.to ? styles.meta : styles.routeTo} testID={id('to-note')}>{draft.toNote}</Text>
          </View>
          <Text style={styles.label}>{t('office.permitPath.ask.subject', 'Subject')}</Text>
          <TextInput
            style={styles.input}
            value={subject}
            onChangeText={setSubject}
            accessibilityLabel={t('office.permitPath.ask.subject', 'Subject')}
            testID={id('subject')}
          />
          <Text style={styles.label}>{t('office.permitPath.ask.body', 'Email')}</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={body}
            onChangeText={setBody}
            multiline
            accessibilityLabel={t('office.permitPath.ask.body', 'Email')}
            testID={id('body')}
          />
          <View style={styles.row}>
            <Button
              label={t('office.permitPath.ask.gotAnswer', 'I Got an Answer')}
              variant="ghost"
              size="sm"
              onPress={onSaveAnswer}
              testID={id('email-got-answer')}
            />
          </View>
        </View>
      ) : (
        <View testID={id('call')}>
          <View style={styles.routing}>
            {draft.call.tel ? (
              <Button
                label={t('office.permitPath.ask.callOffice', 'Call {office}', { office: draft.officeLabel })}
                variant="secondary"
                size="sm"
                iconLeft={<Phone size={14} color={colors.text} strokeWidth={2} />}
                onPress={() => { void call(); }}
                testID={id('dial')}
              />
            ) : null}
            {draft.call.phoneLabel ? (
              <Text style={styles.routeTo} testID={id('phone')}>{draft.call.phoneLabel}</Text>
            ) : (
              <Text style={styles.meta} testID={id('no-phone')}>
                {t('office.permitPath.ask.noPhone', 'No phone number on file for {office}.', { office: draft.officeLabel })}
              </Text>
            )}
            {draft.call.hours ? <Text style={styles.meta} testID={id('hours')}>{draft.call.hours}</Text> : null}
          </View>
          <Text style={styles.label}>{t('office.permitPath.ask.say', 'Start With')}</Text>
          <Text style={styles.text}>{draft.call.opener}</Text>
          <Text style={styles.label}>{t('office.permitPath.ask.questions', 'Ask')}</Text>
          {draft.call.numbered.map((q, i) => (
            <Text key={`q-${i}`} style={styles.text} testID={id(`q-${i}`)}>{`${i + 1}. ${q}`}</Text>
          ))}
          <Text style={styles.label}>{t('office.permitPath.ask.capture', 'Write Down')}</Text>
          {draft.call.capture.map((c, i) => (
            <Text key={`c-${i}`} style={styles.text}>{`· ${c}`}</Text>
          ))}
        </View>
      )}

      {draft.remaining > 0 && onAskNext ? (
        <View style={styles.row}>
          <Text style={styles.meta}>
            {t('office.permitPath.ask.asking', 'This asks {count} of {total}.', { count, total: count + draft.remaining })}
          </Text>
          <Button
            label={t('office.permitPath.ask.askNext', 'Ask the next {n}', { n: draft.remaining })}
            variant="ghost"
            size="sm"
            onPress={onAskNext}
            testID={id('ask-next')}
          />
        </View>
      ) : null}

      <View style={styles.footer} testID={id('source')}>
        <Text style={styles.meta}>{draft.sourceLine}</Text>
        {draft.nameOnly ? <Badge tone="warn">{NAME_ONLY_BADGE}</Badge> : null}
      </View>
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
    multiline: { minHeight: 200, textAlignVertical: 'top' },
    text: { ...Type.body, color: t.text, marginTop: 2 },
    meta: { ...Type.footnote, color: t.textMuted, marginTop: 4 },
    routing: { ...cardSurface(t, { radius: 'md', pad: 12 }), marginTop: 12, gap: 4, alignItems: 'flex-start' },
    routeTo: { ...Type.subhead, color: t.text },
    row: { marginTop: 12, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    footer: { marginTop: 16, gap: 6, alignItems: 'flex-start' },
  });

export default AskDepartmentSheet;
