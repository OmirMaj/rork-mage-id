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
import { View, Text, StyleSheet, Modal, TextInput, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
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
}

export default function RecordPaymentModal({
  visible, title, amountLabel, initial, mode = 'pay', onCancel, onSubmit, onSkip,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors: t } = useTheme();
  const insets = useSafeAreaInsets();

  const [method, setMethod] = useState<PaymentMethod>(
    (initial?.method as PaymentMethod) ?? 'check',
  );
  const [reference, setReference] = useState(initial?.reference ?? '');
  const [paidOn, setPaidOn] = useState(initial?.paidOn ?? todayLocalISO());

  const submit = () => onSubmit({ method, reference, paidOn });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={[styles.card, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{mode === 'reconcile' ? 'Payment detail' : 'Record payment'}</Text>
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

            <Text style={styles.fieldLabel}>Date paid</Text>
            <TextInput
              style={styles.input}
              value={paidOn}
              onChangeText={setPaidOn}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={t.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
              testID="payment-date-input"
            />
            <Text style={styles.fieldHint}>
              The day the money actually left your account — not today, if the check was written earlier.
            </Text>
          </ScrollView>

          <TouchableOpacity style={styles.primaryBtn} onPress={submit} accessibilityRole="button" testID="payment-save">
            <Text style={styles.primaryBtnText}>
              {mode === 'reconcile' ? 'Save payment detail' : 'Record payment'}
            </Text>
          </TouchableOpacity>
          {mode === 'pay' && onSkip ? (
            <TouchableOpacity style={styles.skipBtn} onPress={onSkip} accessibilityRole="button" testID="payment-skip">
              <Text style={styles.skipBtnText}>Mark paid, add detail later</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
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

  primaryBtn: {
    marginTop: 18, minHeight: 50, borderRadius: Tokens.radius.lg,
    backgroundColor: t.accentFill,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  primaryBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },
  skipBtn: { marginTop: 10, minHeight: 44, alignItems: 'center' as const, justifyContent: 'center' as const },
  skipBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textMuted },
});
