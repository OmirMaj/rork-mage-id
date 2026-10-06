// RecordPaymentModal — capture how a sub invoice actually got paid.
//
// MAGE does not move money. This records the payment the GC made elsewhere
// (check, ACH, card, cash) so paid-vs-owed reconciles against a bank statement
// and there's an answer to "which check paid this?" at 1099 time.
//
// Deliberately skippable: a GC standing in a supply yard should be able to
// close the balance now and add the check number later. Skipping records the
// payment as 'unreconciled' rather than blocking the flow.

import React, { useState } from 'react';
import { View, Animated, Text, StyleSheet, Modal, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, AlertTriangle, CalendarDays } from 'lucide-react-native';
import DatePickerModal from '@/components/DatePickerModal';
import { formatCalendarDay } from '@/utils/calendarDate';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useSheetFrame, useSheetPrimaryHotkey } from '@/components/ui';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  REFERENCE_LABELS,
  type PaymentMethod,
} from '@/utils/apReconciliation';

/** Local YYYY-MM-DD — NOT toISOString(), which shifts to UTC and can land a
 *  Friday-evening check on Saturday's statement. */
function todayLocalISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** C7: the day money left the account can't be after today. Both sides are
 *  local YYYY-MM-DD, so a string compare is a day compare. */
export function isFuturePaidOn(day: string, todayISO: string): boolean {
  return day > todayISO;
}
export const FUTURE_PAID_ON_REFUSAL = 'That day hasn’t happened yet. Pick the day the money left your account.';

export interface PaymentDetail {
  method?: string;
  reference?: string;
  paidOn?: string;
}

interface Props {
  visible: boolean;
  /** Shown in the header so the GC knows what they're paying. */
  title?: string;
  amountLabel?: string;
  /** Prefill when correcting an already-recorded payment. */
  initial?: PaymentDetail;
  /** 'pay' = closing the balance now; 'reconcile' = adding detail after. */
  mode?: 'pay' | 'reconcile';
  onCancel: () => void;
  onSubmit: (detail: PaymentDetail) => void;
  /** Close the balance without detail — omitted in 'reconcile' mode. */
  onSkip?: () => void;
  /** A heads-up for the date being entered (e.g. the sub's workers' comp
   *  doesn't cover it). Shown above the buttons; it never disables or delays
   *  the payment. */
  notice?: (paidOn: string) => string | null;
}

export default function RecordPaymentModal({
  visible, title, amountLabel, initial, mode = 'pay', onCancel, onSubmit, onSkip, notice,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors: t } = useTheme();
  const insets = useSafeAreaInsets();

  const [method, setMethod] = useState<PaymentMethod>(
    (initial?.method as PaymentMethod) ?? 'check',
  );
  const [reference, setReference] = useState(initial?.reference ?? '');
  const [paidOn, setPaidOn] = useState(initial?.paidOn ?? todayLocalISO());
  // C7 (UX wave): the day comes from the picker, never a typed YYYY-MM-DD.
  // A future day is refused HERE, not by the picker: without allowFuture the
  // picker only caps the YEAR, so its Month/Day wheels still reach December.
  // Money that has not left the account yet is not a payment to record.
  const [datePicker, setDatePicker] = useState(false);
  const [futureRefused, setFutureRefused] = useState(false);
  const pickPaidOn = (iso: string) => {
    const day = iso.slice(0, 10);
    setDatePicker(false);
    if (isFuturePaidOn(day, todayLocalISO())) { setFutureRefused(true); return; }
    setFutureRefused(false);
    setPaidOn(day);
  };

  const submit = () => onSubmit({ method, reference, paidOn });
  const noticeText = notice ? notice(paidOn) : null;
  // Desktop: a centred form card. It records a payment ledger entry, so the
  // primary takes Cmd+Enter only — never Cmd+S, which the open dialog still
  // swallows so "Save page as" does not open (contract C10).
  const f = useSheetFrame('form', { visible, animationType: 'slide', rise: true });
  useSheetPrimaryHotkey(visible, submit, { saveKey: false });

  return (
    <Modal visible={visible} transparent animationType={f.animationType} onRequestClose={onCancel}>
      <View style={[styles.overlay, f.overlay]}>
        <Animated.View style={[styles.card, { paddingBottom: insets.bottom + 20 }, f.card, f.cardMotion]}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{mode === 'reconcile' ? 'Payment Detail' : 'Record Payment'}</Text>
              {title ? <Text style={styles.subtitle} numberOfLines={1}>{title}{amountLabel ? ` · ${amountLabel}` : ''}</Text> : null}
            </View>
            <TouchableOpacity onPress={onCancel} style={styles.closeBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={t.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>
            MAGE doesn&rsquo;t move the money — record the payment you made so this
            reconciles against your bank statement.
          </Text>

          <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>How did you pay?</Text>
            <View style={styles.methodRow}>
              {PAYMENT_METHODS.map(m => (
                <TouchableOpacity
                  key={m}
                  onPress={() => setMethod(m)}
                  style={[styles.methodChip, method === m && styles.methodChipOn]}
                  accessibilityRole="button"
                  testID={`payment-method-${m}`}
                >
                  <Text style={[styles.methodChipText, method === m && styles.methodChipTextOn]}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>{REFERENCE_LABELS[method]}</Text>
            <TextInput
              style={styles.input}
              value={reference}
              onChangeText={setReference}
              placeholder={method === 'check' ? '1042' : 'Reference'}
              placeholderTextColor={t.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              testID="payment-reference-input"
            />

            <Text style={styles.fieldLabel}>Date Paid</Text>
            <TouchableOpacity
              style={[styles.input, styles.dateField]}
              onPress={() => setDatePicker(true)}
              accessibilityRole="button"
              accessibilityLabel={`Date paid, ${formatCalendarDay(paidOn)}. Change`}
              testID="payment-date-input"
            >
              <Text style={styles.dateText}>{formatCalendarDay(paidOn)}</Text>
              <CalendarDays size={16} color={t.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
            {futureRefused ? (
              <Text style={[styles.fieldHint, styles.fieldHintRefused]} testID="payment-date-future" accessibilityRole="alert">
                {FUTURE_PAID_ON_REFUSAL}
              </Text>
            ) : null}
            <Text style={styles.fieldHint}>
              The day the money actually left your account — not today, if the check was written earlier.
            </Text>
          </ScrollView>

          {noticeText ? (
            <View style={styles.notice} testID="insaudit-pay-warning" accessibilityRole="alert">
              <AlertTriangle size={14} color={t.warningLabel} strokeWidth={1.75} style={styles.noticeIcon} />
              <Text style={styles.noticeText}>{noticeText}</Text>
            </View>
          ) : null}

          <TouchableOpacity style={styles.primaryBtn} onPress={submit} accessibilityRole="button" testID="payment-save">
            <Text style={styles.primaryBtnText}>
              {mode === 'reconcile' ? 'Save Payment Detail' : 'Record Payment'}
            </Text>
          </TouchableOpacity>
          {mode === 'pay' && onSkip ? (
            <TouchableOpacity style={styles.skipBtn} onPress={onSkip} accessibilityRole="button" testID="payment-skip">
              <Text style={styles.skipBtnText}>Mark Paid, Add Detail Later</Text>
            </TouchableOpacity>
          ) : null}
        </Animated.View>
      </View>
      {datePicker ? (
        <DatePickerModal
          visible
          value={paidOn}
          title="Date Paid"
          onClose={() => setDatePicker(false)}
          onChange={pickPaidOn}
        />
      ) : null}
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' as const },
  card: {
    backgroundColor: t.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 18,
  },
  header: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10 },
  title: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text },
  subtitle: { fontSize: Type.footnote.fontSize, color: t.textMuted, marginTop: 2 },
  closeBtn: { width: 32, height: 32, alignItems: 'center' as const, justifyContent: 'center' as const },
  hint: { fontSize: Type.footnote.fontSize, color: t.textMuted, lineHeight: 18, marginTop: 8, marginBottom: 4 },

  fieldLabel: {
    fontSize: Type.caption1.fontSize, fontWeight: '700' as const,
    color: t.textSecondary, marginTop: 16, marginBottom: 8,
  },
  fieldHint: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 15, marginTop: 6 },
  fieldHintRefused: { color: t.dangerLabel },

  methodRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  methodChip: {
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
    backgroundColor: t.bg,
  },
  methodChipOn: { borderColor: t.accent, backgroundColor: t.accentSoft },
  methodChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  methodChipTextOn: { color: t.accent },

  input: {
    borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: Type.subhead.fontSize, color: t.text, backgroundColor: t.bg,
  },
  dateField: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, minHeight: 48 },
  dateText: { fontSize: Type.subhead.fontSize, color: t.text },

  notice: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8,
    marginTop: 14, padding: 10, borderRadius: Tokens.radius.sm, backgroundColor: t.surfaceAlt,
  },
  noticeIcon: { marginTop: 2 },
  noticeText: { ...Type.footnote, color: t.text, flex: 1 },

  primaryBtn: {
    marginTop: 18, minHeight: 50, borderRadius: Tokens.radius.lg,
    backgroundColor: t.accentFill,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  primaryBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },
  skipBtn: { marginTop: 10, minHeight: 44, alignItems: 'center' as const, justifyContent: 'center' as const },
  skipBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textMuted },
});
