import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, ScrollView,
  Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { DollarSign, Wallet, Clock, CheckCircle, ChevronRight, Plus, X, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { CashFlowExpense, ExpenseCategory, ExpenseFrequency } from '@/utils/cashFlowEngine';
import type { CashFlowData } from '@/utils/cashFlowStorage';

interface CashFlowSetupProps {
  visible: boolean;
  onComplete: (data: CashFlowData) => void;
  onClose: () => void;
}

const EXPENSE_SUGGESTIONS: Array<{ name: string; category: ExpenseCategory; frequency: ExpenseFrequency }> = [
  { name: 'Payroll', category: 'payroll', frequency: 'weekly' },
  { name: 'Insurance', category: 'insurance', frequency: 'monthly' },
  { name: 'Office Overhead', category: 'overhead', frequency: 'monthly' },
  { name: 'Vehicle Payments', category: 'loan', frequency: 'monthly' },
  { name: 'Equipment Rental', category: 'equipment_rental', frequency: 'monthly' },
];

const TERMS_OPTIONS = [
  { value: 'net_15', label: 'Net 15' },
  { value: 'net_30', label: 'Net 30' },
  { value: 'net_45', label: 'Net 45' },
  { value: 'due_on_receipt', label: 'Due on Receipt' },
];

export default function CashFlowSetup({ visible, onComplete, onClose }: CashFlowSetupProps) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [startingBalance, setStartingBalance] = useState('');
  const [expenses, setExpenses] = useState<CashFlowExpense[]>([]);
  const [defaultTerms, setDefaultTerms] = useState('net_30');

  const handleAddSuggestion = useCallback((suggestion: typeof EXPENSE_SUGGESTIONS[0]) => {
    const exists = expenses.some(e => e.name === suggestion.name);
    if (exists) return;
    const newExpense: CashFlowExpense = {
      id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: suggestion.name,
      amount: 0,
      frequency: suggestion.frequency,
      category: suggestion.category,
      startDate: new Date().toISOString(),
    };
    setExpenses(prev => [...prev, newExpense]);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [expenses]);

  const handleUpdateExpenseAmount = useCallback((id: string, amount: string) => {
    setExpenses(prev => prev.map(e => e.id === id ? { ...e, amount: parseFloat(amount) || 0 } : e));
  }, []);

  const handleRemoveExpense = useCallback((id: string) => {
    setExpenses(prev => prev.filter(e => e.id !== id));
  }, []);

  const handleNext = useCallback(() => {
    if (step < 3) {
      setStep(step + 1);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [step]);

  const handleBack = useCallback(() => {
    if (step > 0) setStep(step - 1);
  }, [step]);

  const handleFinish = useCallback(() => {
    const data: CashFlowData = {
      startingBalance: parseFloat(startingBalance) || 0,
      expenses: expenses.filter(e => e.amount > 0),
      expectedPayments: [],
      defaultPaymentTerms: defaultTerms,
      dailyOverheadCost: 350,
      lastUpdated: new Date().toISOString(),
    };
    onComplete(data);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep(0);
    setStartingBalance('');
    setExpenses([]);
    setDefaultTerms('net_30');
  }, [startingBalance, expenses, defaultTerms, onComplete]);

  const freqLabel = (f: ExpenseFrequency) => {
    switch (f) {
      case 'weekly': return '/week';
      case 'biweekly': return '/2 weeks';
      case 'monthly': return '/month';
      case 'one_time': return 'one-time';
    }
  };

  const renderStep0 = () => (
    <View style={styles.stepContent}>
      <View style={[styles.stepIconWrap, { backgroundColor: Colors.primary + '15' }]}>
        <Wallet size={32} color={Colors.primary} />
      </View>
      <Text style={styles.stepTitle}>Current Bank Balance</Text>
      <Text style={styles.stepDesc}>
        This is your starting point. We'll project forward from here.
      </Text>
      <View style={styles.balanceInputWrap}>
        <Text style={styles.dollarSign}>$</Text>
        <TextInput
          style={styles.balanceInput}
          value={startingBalance}
          onChangeText={setStartingBalance}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={Colors.textMuted}
          testID="starting-balance-input"
        />
      </View>
    </View>
  );

  const renderStep1 = () => (
    <View style={styles.stepContent}>
      <View style={[styles.stepIconWrap, { backgroundColor: Colors.error + '15' }]}>
        <DollarSign size={32} color={Colors.error} />
      </View>
      <Text style={styles.stepTitle}>Recurring Expenses</Text>
      <Text style={styles.stepDesc}>
        Add your regular business expenses. You can always add more later.
      </Text>

      <View style={styles.suggestionsRow}>
        {EXPENSE_SUGGESTIONS.map(s => {
          const added = expenses.some(e => e.name === s.name);
          return (
            <TouchableOpacity
              key={s.name}
              style={[styles.suggestionChip, added && styles.suggestionChipAdded]}
              onPress={() => handleAddSuggestion(s)}
              activeOpacity={0.7}
              disabled={added}
            >
              {added ? <CheckCircle size={14} color={Colors.success} /> : <Plus size={14} color={Colors.primary} />}
              <Text style={[styles.suggestionText, added && { color: Colors.success }]}>{s.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView style={styles.expenseList} showsVerticalScrollIndicator={false}>
        {expenses.map(exp => (
          <View key={exp.id} style={styles.expenseRow}>
            <View style={styles.expenseInfo}>
              <Text style={styles.expenseName}>{exp.name}</Text>
              <Text style={styles.expenseFreq}>{freqLabel(exp.frequency)}</Text>
            </View>
            <View style={styles.expenseAmountWrap}>
              <Text style={styles.expenseDollar}>$</Text>
              <TextInput
                style={styles.expenseAmountInput}
                value={exp.amount > 0 ? exp.amount.toString() : ''}
                onChangeText={(v) => handleUpdateExpenseAmount(exp.id, v)}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
            <TouchableOpacity onPress={() => handleRemoveExpense(exp.id)} style={styles.removeBtn}>
              <Trash2 size={14} color={Colors.error} />
            </TouchableOpacity>
          </View>
        ))}
        {expenses.length === 0 && (
          <Text style={styles.emptyText}>Tap suggestions above to add expenses</Text>
        )}
      </ScrollView>
    </View>
  );

  const renderStep2 = () => (
    <View style={styles.stepContent}>
      <View style={[styles.stepIconWrap, { backgroundColor: Colors.info + '15' }]}>
        <Clock size={32} color={Colors.info} />
      </View>
      <Text style={styles.stepTitle}>Default Payment Terms</Text>
      <Text style={styles.stepDesc}>
        When you invoice clients, how long do they typically take to pay?
      </Text>

      <View style={styles.termsGrid}>
        {TERMS_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.value}
            style={[styles.termsChip, defaultTerms === opt.value && styles.termsChipActive]}
            onPress={() => setDefaultTerms(opt.value)}
            activeOpacity={0.7}
          >
            <Text style={[styles.termsChipText, defaultTerms === opt.value && styles.termsChipTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderStep3 = () => {
    const totalMonthly = expenses.reduce((sum, e) => {
      switch (e.frequency) {
        case 'weekly': return sum + e.amount * 4.33;
        case 'biweekly': return sum + e.amount * 2.17;
        case 'monthly': return sum + e.amount;
        case 'one_time': return sum;
        default: return sum;
      }
    }, 0);

    return (
      <View style={styles.stepContent}>
        <View style={[styles.stepIconWrap, { backgroundColor: Colors.success + '15' }]}>
          <CheckCircle size={32} color={Colors.success} />
        </View>
        <Text style={styles.stepTitle}>You're All Set!</Text>
        <Text style={styles.stepDesc}>
          As you create invoices and track expenses in MAGE ID, your forecast gets smarter automatically.
        </Text>

        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Starting Balance</Text>
            <Text style={styles.summaryValue}>${(parseFloat(startingBalance) || 0).toLocaleString()}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Recurring Expenses</Text>
            <Text style={styles.summaryValue}>{expenses.filter(e => e.amount > 0).length} items</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Est. Monthly Burn</Text>
            <Text style={[styles.summaryValue, { color: Colors.error }]}>
              ${totalMonthly.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Payment Terms</Text>
            <Text style={styles.summaryValue}>
              {TERMS_OPTIONS.find(t => t.value === defaultTerms)?.label}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const steps = [renderStep0, renderStep1, renderStep2, renderStep3];
  const isLast = step === 3;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined} onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.container, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={20} color={Colors.textMuted} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Cash Flow Setup</Text>
            <Text style={styles.stepIndicator}>{step + 1}/4</Text>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${((step + 1) / 4) * 100}%` }]} />
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {steps[step]()}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
            {step > 0 && (
              <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.7}>
                <Text style={styles.backButtonText}>Back</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.nextButton, step === 0 && { flex: 1 }]}
              onPress={isLast ? handleFinish : handleNext}
              activeOpacity={0.85}
            >
              <Text style={styles.nextButtonText}>{isLast ? 'Start Forecasting' : 'Continue'}</Text>
              {!isLast && <ChevronRight size={18} color={Colors.textOnPrimary} />}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  handle: { width: 36, height: 5, borderRadius: 3, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  stepIndicator: { fontSize: 14, fontWeight: '600' as const, color: Colors.textMuted },
  progressTrack: { height: 4, backgroundColor: Colors.fillTertiary, marginHorizontal: 20, borderRadius: 2, overflow: 'hidden' as const },
  progressFill: { height: 4, backgroundColor: Colors.primary, borderRadius: 2 },
  stepContent: { paddingHorizontal: 20, paddingTop: 32, alignItems: 'center' },
  stepIconWrap: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  stepTitle: { fontSize: 24, fontWeight: '800' as const, color: Colors.text, textAlign: 'center', marginBottom: 8 },
  stepDesc: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 24, paddingHorizontal: 16 },
  balanceInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 16, paddingHorizontal: 20, borderWidth: 2, borderColor: Colors.primary + '30', width: '100%', maxWidth: 280 },
  dollarSign: { fontSize: 28, fontWeight: '800' as const, color: Colors.primary, marginRight: 4 },
  balanceInput: { flex: 1, fontSize: 32, fontWeight: '800' as const, color: Colors.text, minHeight: 64, textAlign: 'center' },
  suggestionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, width: '100%', marginBottom: 16 },
  suggestionChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.fillTertiary },
  suggestionChipAdded: { backgroundColor: Colors.successLight, borderWidth: 1, borderColor: Colors.success + '30' },
  suggestionText: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  expenseList: { width: '100%', maxHeight: 280 },
  expenseRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: Colors.cardBorder, gap: 10 },
  expenseInfo: { flex: 1, gap: 2 },
  expenseName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  expenseFreq: { fontSize: 12, color: Colors.textMuted },
  expenseAmountWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 8 },
  expenseDollar: { fontSize: 14, fontWeight: '700' as const, color: Colors.textSecondary },
  expenseAmountInput: { width: 80, minHeight: 36, fontSize: 16, fontWeight: '700' as const, color: Colors.text, textAlign: 'right' },
  removeBtn: { padding: 6 },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', paddingVertical: 20 },
  termsGrid: { width: '100%', gap: 10 },
  termsChip: { paddingVertical: 16, paddingHorizontal: 20, borderRadius: 14, backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.cardBorder, alignItems: 'center' },
  termsChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  termsChipText: { fontSize: 16, fontWeight: '600' as const, color: Colors.text },
  termsChipTextActive: { color: Colors.primary },
  summaryCard: { width: '100%', backgroundColor: Colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Colors.cardBorder },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  summaryLabel: { fontSize: 14, color: Colors.textSecondary },
  summaryValue: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  summaryDivider: { height: 1, backgroundColor: Colors.borderLight },
  footer: { paddingHorizontal: 20, paddingTop: 12, flexDirection: 'row', gap: 10, backgroundColor: Colors.background, borderTopWidth: 0.5, borderTopColor: Colors.borderLight },
  backButton: { flex: 1, minHeight: 50, borderRadius: 14, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  backButtonText: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  nextButton: { flex: 2, minHeight: 50, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  nextButtonText: { fontSize: 16, fontWeight: '700' as const, color: Colors.textOnPrimary },
});
