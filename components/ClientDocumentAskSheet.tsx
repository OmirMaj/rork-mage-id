// components/ClientDocumentAskSheet.tsx — the one sheet behind "ask when it
// matters". Renders exactly one question at a time from the props
// hooks/useClientDocumentGate.ts builds; owns no state and no copy (every word
// comes from utils/clientDocumentAsk.ts through `copy`).
//
// Layout choices that are load-bearing:
//   · KeyboardAvoidingView (padding on iOS) keeps the primary button above the
//     number pad — a GC typing a deposit must be able to reach "Use on every
//     job" without dismissing the keyboard first.
//   · Percent fields start EMPTY with no digits in the placeholder. A
//     placeholder "25" is a suggestion that reads as an answer, which is the
//     guessed-terms bug this whole flow replaces.
//   · The reason always renders, under the title. A question with no "why" is
//     a form; this is the document in his hand explaining what it prints.
//   · On wide web the sheet is centred at ≤520pt instead of stretching a
//     phone bottom sheet across a desktop monitor.
//   · The RN Modal stays MOUNTED and is closed through `visible`, showing the
//     last question while it slides out. Unmounting it in the press that runs
//     the paused action skips the dismissal entirely, and on iOS a share
//     sheet or second modal presented while one is still going away can be
//     refused. `onDismiss` (iOS: fires once the slide-out has finished) is the
//     hook for a continuation that must present native UI; the gate's own
//     `then` still runs in the press, because web print / clipboard need the
//     gesture.

import React, { useRef } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { X } from 'lucide-react-native';
import { Button, Card } from '@/components/ui';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ClientDocumentAskSheetProps } from '@/hooks/useClientDocumentGate';

export type { ClientDocumentAskSheetProps };

const WIDE_BREAKPOINT = 768;

const noop = () => {};

export default function ClientDocumentAskSheet(props: ClientDocumentAskSheetProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;

  // The last open step, kept so the closing slide shows what he just answered
  // instead of an empty card. While closed every handler is inert: a tap on
  // the outgoing sheet must not submit, type or close anything.
  const live = props.visible && !!props.question && !!props.copy;
  const lastShown = useRef<ClientDocumentAskSheetProps | null>(null);
  if (live) lastShown.current = props;
  const shown = live ? props : lastShown.current;
  const {
    question, copy, identityGap, draft, hint, termsLine, warrantyLine, depositNote,
  } = shown ?? props;
  const onChangeDraft = live ? props.onChangeDraft : noop;
  const onPrimary = live ? props.onPrimary : noop;
  const onSecondary = live ? props.onSecondary : (shown?.onSecondary ? noop : null);
  const onClose = live ? props.onClose : noop;

  return (
    <Modal visible={live} transparent animationType="slide" onRequestClose={onClose} onDismiss={props.onDismiss}>
      {question && copy ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.backdrop, wide && styles.backdropWide]}>
            <Card radius="xl" pad={Tokens.spacing.lg} style={[styles.sheet, wide && styles.sheetWide]}>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
                <View style={styles.headerRow}>
                  <View style={styles.flex}>
                    {copy.stepLabel ? <Text style={styles.stepLabel}>{copy.stepLabel}</Text> : null}
                    <Text style={styles.questionTitle} testID="ask-step-title" accessibilityRole="header">
                      {copy.title}
                    </Text>
                  </View>
                  <Pressable
                    onPress={onClose}
                    hitSlop={10}
                    style={styles.closeBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Close — nothing is sent"
                    testID="ask-close"
                  >
                    <X size={18} color={colors.textMuted} strokeWidth={1.9} />
                  </Pressable>
                </View>

                <Text style={styles.reason} testID="ask-reason">{copy.reason}</Text>

                {question === 'identity' && (
                  <View style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>Company name</Text>
                    <TextInput
                      style={styles.input}
                      value={draft.companyName}
                      onChangeText={(v) => onChangeDraft({ companyName: v })}
                      placeholder="Your company, as the homeowner should see it"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="words"
                      testID="ask-identity-company"
                      accessibilityLabel="Company name"
                    />
                    {identityGap?.rule ? (
                      <>
                        <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>
                          {identityGap.rule.authority} licence number
                        </Text>
                        <TextInput
                          style={styles.input}
                          value={draft.licenseNumber}
                          onChangeText={(v) => onChangeDraft({ licenseNumber: v })}
                          placeholder="Licence number"
                          placeholderTextColor={colors.textMuted}
                          autoCapitalize="characters"
                          autoCorrect={false}
                          testID="ask-identity-licence"
                          accessibilityLabel={`${identityGap.rule.authority} licence number`}
                        />
                        <Text style={styles.citation}>{identityGap.rule.citation}</Text>
                      </>
                  ) : null}
                </View>
              )}

              {question === 'terms' && (
                <View style={styles.fieldBlock}>
                  <View style={styles.percentRow}>
                    <PercentField
                      label="Deposit"
                      value={draft.deposit}
                      onChange={(v) => onChangeDraft({ deposit: v })}
                      testID="ask-terms-deposit"
                      styles={styles}
                      placeholderColor={colors.textMuted}
                    />
                    <PercentField
                      label="Progress"
                      value={draft.progress}
                      onChange={(v) => onChangeDraft({ progress: v })}
                      testID="ask-terms-progress"
                      styles={styles}
                      placeholderColor={colors.textMuted}
                    />
                    <PercentField
                      label="Final"
                      value={draft.final}
                      onChange={(v) => onChangeDraft({ final: v })}
                      testID="ask-terms-final"
                      styles={styles}
                      placeholderColor={colors.textMuted}
                    />
                  </View>
                  {termsLine.kind !== 'empty' ? (
                    <Text
                      style={termsLine.kind === 'hint' ? styles.liveHint : styles.liveLine}
                      testID="ask-terms-dollars"
                    >
                      {termsLine.text}
                    </Text>
                  ) : null}
                  {depositNote ? (
                    <Text style={styles.note} testID="ask-deposit-note">{depositNote}</Text>
                  ) : null}
                </View>
              )}

              {question === 'warranty' && (
                <View style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>Months</Text>
                  <TextInput
                    style={[styles.input, styles.monthsInput]}
                    value={draft.months}
                    onChangeText={(v) => onChangeDraft({ months: v })}
                    keyboardType="number-pad"
                    testID="ask-warranty-months"
                    accessibilityLabel="Warranty length in months"
                  />
                  {warrantyLine.kind !== 'empty' ? (
                    <Text style={warrantyLine.kind === 'hint' ? styles.liveHint : styles.liveLine}>
                      {warrantyLine.text}
                    </Text>
                  ) : null}
                </View>
              )}

              {hint ? (
                <Text style={styles.hint} testID="ask-hint" accessibilityLiveRegion="polite">{hint}</Text>
              ) : null}

              <View style={styles.actions}>
                <Button label={copy.primaryLabel} onPress={onPrimary} fullWidth testID="ask-primary" />
                {onSecondary && copy.secondaryLabel ? (
                  <Button
                    label={copy.secondaryLabel}
                    onPress={onSecondary}
                    variant="secondary"
                    fullWidth
                    testID="ask-secondary"
                  />
                ) : null}
              </View>

              {copy.footnote ? <Text style={styles.footnote}>{copy.footnote}</Text> : null}
            </ScrollView>
          </Card>
        </View>
      </KeyboardAvoidingView>
      ) : null}
    </Modal>
  );
}

function PercentField({
  label, value, onChange, testID, styles, placeholderColor,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testID: string;
  styles: ReturnType<typeof makeStyles>;
  placeholderColor: string;
}) {
  return (
    <View style={styles.percentField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.percentInputRow}>
        <TextInput
          style={[styles.input, styles.percentInput]}
          value={value}
          onChangeText={onChange}
          keyboardType="number-pad"
          maxLength={4}
          placeholderTextColor={placeholderColor}
          testID={testID}
          accessibilityLabel={`${label} percent`}
        />
        <Text style={styles.percentSuffix}>%</Text>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  backdropWide: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Tokens.spacing.xl,
  },
  sheet: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    maxHeight: '92%',
  },
  sheetWide: {
    width: '100%',
    maxWidth: 520,
    borderBottomLeftRadius: Tokens.radius.xl,
    borderBottomRightRadius: Tokens.radius.xl,
  },
  body: { gap: Tokens.spacing.sm, paddingBottom: Tokens.spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Tokens.spacing.sm },
  stepLabel: { ...Type.caption1, color: t.textMuted, marginBottom: Tokens.spacing.xxs },
  questionTitle: { ...Type.serifHeadline, color: t.text },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  reason: { ...Type.bodyCompact, color: t.textSecondary },
  fieldBlock: { gap: Tokens.spacing.xs, marginTop: Tokens.spacing.xxs },
  fieldLabel: { ...Type.footnoteEmphasized, color: t.text },
  fieldLabelSpaced: { marginTop: Tokens.spacing.xs },
  input: {
    ...Type.body,
    color: t.text,
    backgroundColor: t.bg,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.sm,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: Tokens.spacing.xs,
    minHeight: 44,
  },
  citation: { ...Type.caption1, color: t.textMuted },
  percentRow: { flexDirection: 'row', gap: Tokens.spacing.sm },
  percentField: { flex: 1, gap: Tokens.spacing.xxs },
  percentInputRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs },
  percentInput: { flex: 1, textAlign: 'right' },
  percentSuffix: { ...Type.body, color: t.textSecondary },
  monthsInput: { maxWidth: 120 },
  liveLine: { ...Type.footnote, color: t.text },
  liveHint: { ...Type.footnote, color: t.warningLabel },
  note: { ...Type.footnote, color: t.textSecondary },
  hint: { ...Type.footnote, color: t.dangerLabel },
  actions: { gap: Tokens.spacing.xs, marginTop: Tokens.spacing.xs },
  footnote: { ...Type.caption1, color: t.textMuted, textAlign: 'center' },
});
