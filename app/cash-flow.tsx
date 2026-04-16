import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal,
  Platform, KeyboardAvoidingView, ActivityIndicator, Alert, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  TrendingUp, TrendingDown, DollarSign, Plus, X, Trash2, Edit3,
  AlertTriangle, CheckCircle, Sparkles, ChevronDown, ChevronUp,
  Calendar, Clock, Wallet, BarChart3, RefreshCw,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import CashFlowChart from '@/components/CashFlowChart';
import CashFlowSetup from '@/components/CashFlowSetup';
import {
  generateForecast, calculateSummary, formatCurrency, formatCurrencyShort,
} from '@/utils/cashFlowEngine';
import type { CashFlowExpense, ExpectedPayment, CashFlowWeek, CashFlowSummary, ExpenseCategory, ExpenseFrequency } from '@/utils/cashFlowEngine';
import {
  loadCashFlowData, saveCashFlowData, isSetupComplete, markSetupComplete,
  getCachedAIAnalysis, setCachedAIAnalysis,
} from '@/utils/cashFlowStorage';
import type { CashFlowData } from '@/utils/cashFlowStorage';
import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';

const cashFlowAnalysisSchema = z.object({
  overallHealth: z.enum(['healthy', 'caution', 'danger']),
  healthScore: z.number(),
  criticalWeeks: z.array(z.object({
    weekNumber: z.number(),
    weekDate: z.string(),
    balance: z.number(),
    problem: z.string(),
  })),
  recommendations: z.array(z.object({
    priority: z.enum(['urgent', 'important', 'suggestion']),
    action: z.string(),
    impact: z.string(),
    difficulty: z.enum(['easy', 'moderate', 'hard']),
  })),
  billingOptimizations: z.array(z.string()),
  expenseReductions: z.array(z.string()),
  summary: z.string(),
});

type AIAnalysis = z.infer<typeof cashFlowAnalysisSchema>;

const EXPENSE_CATEGORIES: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'payroll', label: 'Payroll' },
  { value: 'materials', label: 'Materials' },
  { value: 'equipment_rental', label: 'Equipment Rental' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'overhead', label: 'Overhead' },
  { value: 'loan', label: 'Loan/Financing' },
  { value: 'other', label: 'Other' },
];

const FREQUENCY_OPTIONS: Array<{ value: ExpenseFrequency; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'one_time', label: 'One-time' },
];

const FORECAST_OPTIONS = [
  { weeks: 4, label: '4 Weeks' },
  { weeks: 8, label: '8 Weeks' },
  { weeks: 12, label: '12 Weeks' },
  { weeks: 26, label: '6 Months' },
];

export default function CashFlowScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, invoices: allInvoices, getInvoicesForProject } = useProjects();

  const [loading, setLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [cashFlowData, setCashFlowData] = useState<CashFlowData | null>(null);
  const [forecastWeeks, setForecastWeeks] = useState(12);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [showEditBalance, setShowEditBalance] = useState(false);
  const [editBalanceValue, setEditBalanceValue] = useState('');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    expenses: false,
    income: false,
    weekDetail: true,
  });

  const [newExpenseName, setNewExpenseName] = useState('');
  const [newExpenseAmount, setNewExpenseAmount] = useState('');
  const [newExpenseCategory, setNewExpenseCategory] = useState<ExpenseCategory>('other');
  const [newExpenseFrequency, setNewExpenseFrequency] = useState<ExpenseFrequency>('monthly');

  const [newPaymentDesc, setNewPaymentDesc] = useState('');
  const [newPaymentAmount, setNewPaymentAmount] = useState('');
  const [newPaymentDate, setNewPaymentDate] = useState('');
  const [newPaymentConfidence, setNewPaymentConfidence] = useState<'confirmed' | 'expected' | 'hopeful'>('expected');

  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAiResults, setShowAiResults] = useState(false);

  const relevantInvoices = useMemo(() => {
    if (projectId) return getInvoicesForProject(projectId);
    return allInvoices;
  }, [projectId, allInvoices, getInvoicesForProject]);

  useEffect(() => {
    const init = async () => {
      console.log('[CashFlow] Initializing...');
      const setupDone = await isSetupComplete();
      const data = await loadCashFlowData();
      setCashFlowData(data);
      if (!setupDone) {
        setShowSetup(true);
      }
      const cached = await getCachedAIAnalysis(projectId);
      if (cached) {
        setAiAnalysis(cached.data as AIAnalysis);
      }
      setLoading(false);
    };
    void init();
  }, [projectId]);

  const forecast = useMemo<CashFlowWeek[]>(() => {
    if (!cashFlowData) return [];
    return generateForecast(
      cashFlowData.startingBalance,
      cashFlowData.expenses,
      relevantInvoices,
      cashFlowData.expectedPayments,
      forecastWeeks,
      cashFlowData.defaultPaymentTerms
    );
  }, [cashFlowData, relevantInvoices, forecastWeeks]);

  const summary = useMemo<CashFlowSummary>(() => calculateSummary(forecast), [forecast]);

  const selectedWeekData = useMemo(() => {
    if (selectedWeek === null || !forecast[selectedWeek]) return null;
    return forecast[selectedWeek];
  }, [selectedWeek, forecast]);

  const handleSetupComplete = useCallback(async (data: CashFlowData) => {
    setCashFlowData(data);
    await saveCashFlowData(data);
    await markSetupComplete();
    setShowSetup(false);
    console.log('[CashFlow] Setup complete');
  }, []);

  const handleUpdateBalance = useCallback(async () => {
    if (!cashFlowData) return;
    const bal = parseFloat(editBalanceValue) || 0;
    const updated = { ...cashFlowData, startingBalance: bal };
    setCashFlowData(updated);
    await saveCashFlowData(updated);
    setShowEditBalance(false);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [cashFlowData, editBalanceValue]);

  const handleAddExpense = useCallback(async () => {
    if (!cashFlowData || !newExpenseName.trim()) return;
    const expense: CashFlowExpense = {
      id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: newExpenseName.trim(),
      amount: parseFloat(newExpenseAmount) || 0,
      frequency: newExpenseFrequency,
      category: newExpenseCategory,
      startDate: new Date().toISOString(),
    };
    const updated = { ...cashFlowData, expenses: [...cashFlowData.expenses, expense] };
    setCashFlowData(updated);
    await saveCashFlowData(updated);
    setShowAddExpense(false);
    setNewExpenseName('');
    setNewExpenseAmount('');
    setNewExpenseCategory('other');
    setNewExpenseFrequency('monthly');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [cashFlowData, newExpenseName, newExpenseAmount, newExpenseFrequency, newExpenseCategory]);

  const handleRemoveExpense = useCallback(async (id: string) => {
    if (!cashFlowData) return;
    const updated = { ...cashFlowData, expenses: cashFlowData.expenses.filter(e => e.id !== id) };
    setCashFlowData(updated);
    await saveCashFlowData(updated);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [cashFlowData]);

  const handleAddPayment = useCallback(async () => {
    if (!cashFlowData || !newPaymentDesc.trim()) return;
    const daysFromNow = parseInt(newPaymentDate) || 30;
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    const payment: ExpectedPayment = {
      id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      description: newPaymentDesc.trim(),
      amount: parseFloat(newPaymentAmount) || 0,
      expectedDate: date.toISOString(),
      confidence: newPaymentConfidence,
      projectId: projectId,
    };
    const updated = { ...cashFlowData, expectedPayments: [...cashFlowData.expectedPayments, payment] };
    setCashFlowData(updated);
    await saveCashFlowData(updated);
    setShowAddPayment(false);
    setNewPaymentDesc('');
    setNewPaymentAmount('');
    setNewPaymentDate('');
    setNewPaymentConfidence('expected');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [cashFlowData, newPaymentDesc, newPaymentAmount, newPaymentDate, newPaymentConfidence, projectId]);

  const handleRemovePayment = useCallback(async (id: string) => {
    if (!cashFlowData) return;
    const updated = { ...cashFlowData, expectedPayments: cashFlowData.expectedPayments.filter(p => p.id !== id) };
    setCashFlowData(updated);
    await saveCashFlowData(updated);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [cashFlowData]);

  const handleAIAnalysis = useCallback(async () => {
    if (forecast.length === 0 || !cashFlowData) return;
    setAiLoading(true);
    setShowAiResults(true);
    try {
      const aiResult = await mageAI({
        prompt: `You are a construction financial advisor. Analyze this contractor's cash flow forecast and provide specific, actionable advice to prevent cash shortages and improve financial health.

FORECAST DATA (next ${forecastWeeks} weeks):
${forecast.map((w, i) => `Week ${i + 1} (${w.weekStart}): Income ${w.totalIncome} | Expenses ${w.totalExpenses} | Net ${w.netCashFlow} | Balance ${w.runningBalance}`).join('\n')}

RECURRING EXPENSES:
${cashFlowData.expenses.map(e => `${e.name}: ${e.amount}/${e.frequency}`).join('\n') || 'None entered'}

PENDING INVOICES:
${relevantInvoices.filter(i => i.status !== 'paid').map(i => `#${i.number}: ${i.totalDue} | Sent: ${i.issueDate} | Terms: ${i.paymentTerms} | Due: ${i.dueDate}`).join('\n') || 'None pending'}

Identify any weeks where the balance goes negative or dangerously low (under $5,000). For each problem, give a SPECIFIC fix — not generic advice. Reference actual invoice numbers, expense names, and dollar amounts. Suggest billing optimizations and expense reductions specific to their actual data.`,
        schema: cashFlowAnalysisSchema,
        tier: 'smart',
        maxTokens: 2000,
      });
      if (!aiResult.success) {
        Alert.alert('AI Unavailable', aiResult.error || 'Try again.');
        return;
      }
      setAiAnalysis(aiResult.data);
      await setCachedAIAnalysis(result, projectId);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('[CashFlow] AI analysis failed:', err);
      Alert.alert('AI Unavailable', 'Cash flow analysis is unavailable right now. Try again in a moment.');
    } finally {
      setAiLoading(false);
    }
  }, [forecast, cashFlowData, forecastWeeks, relevantInvoices, projectId]);

  const toggleSection = useCallback((key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const totalMonthlyExpenses = useMemo(() => {
    if (!cashFlowData) return 0;
    return cashFlowData.expenses.reduce((sum, e) => {
      switch (e.frequency) {
        case 'weekly': return sum + e.amount * 4.33;
        case 'biweekly': return sum + e.amount * 2.17;
        case 'monthly': return sum + e.amount;
        default: return sum;
      }
    }, 0);
  }, [cashFlowData]);

  const freqLabel = (f: ExpenseFrequency) => {
    switch (f) {
      case 'weekly': return '/week';
      case 'biweekly': return '/2wk';
      case 'monthly': return '/mo';
      case 'one_time': return 'once';
    }
  };

  const confidenceBadge = (c: string) => {
    switch (c) {
      case 'confirmed': return { bg: Colors.successLight, text: Colors.success, label: 'Confirmed' };
      case 'expected': return { bg: Colors.infoLight, text: Colors.info, label: 'Expected' };
      default: return { bg: Colors.warningLight, text: Colors.warning, label: 'Hopeful' };
    }
  };

  const healthColor = (health: string) => {
    switch (health) {
      case 'healthy': return Colors.success;
      case 'caution': return Colors.warning;
      default: return Colors.error;
    }
  };

  const priorityConfig = (p: string) => {
    switch (p) {
      case 'urgent': return { bg: Colors.errorLight, text: Colors.error };
      case 'important': return { bg: Colors.warningLight, text: Colors.warning };
      default: return { bg: Colors.infoLight, text: Colors.info };
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Cash Flow' }} />
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: projectId ? 'Project Cash Flow' : 'Cash Flow Forecast',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        headerRight: () => (
          <TouchableOpacity
            onPress={() => setShowSetup(true)}
            style={{ padding: 6 }}
            activeOpacity={0.7}
          >
            <Edit3 size={20} color={Colors.primary} />
          </TouchableOpacity>
        ),
      }} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroRow}>
            <View style={styles.heroLeft}>
              <Text style={styles.heroLabel}>Starting Balance</Text>
              <TouchableOpacity
                onPress={() => {
                  setEditBalanceValue(cashFlowData?.startingBalance?.toString() ?? '0');
                  setShowEditBalance(true);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.heroAmount}>
                  {formatCurrency(cashFlowData?.startingBalance ?? 0)}
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.editBalanceBtn}
              onPress={() => {
                setEditBalanceValue(cashFlowData?.startingBalance?.toString() ?? '0');
                setShowEditBalance(true);
              }}
              activeOpacity={0.7}
            >
              <Edit3 size={14} color={Colors.primary} />
              <Text style={styles.editBalanceBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.forecastSelector}>
            {FORECAST_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.weeks}
                style={[styles.forecastChip, forecastWeeks === opt.weeks && styles.forecastChipActive]}
                onPress={() => { setForecastWeeks(opt.weeks); setSelectedWeek(null); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.forecastChipText, forecastWeeks === opt.weeks && styles.forecastChipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {forecast.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>FORECAST</Text>
            <CashFlowChart
              weeks={forecast}
              onWeekPress={setSelectedWeek}
              selectedWeek={selectedWeek}
            />
          </View>
        )}

        {summary.dangerWeeks.length > 0 && (
          <View style={styles.section}>
            <View style={styles.dangerCard}>
              <View style={styles.dangerHeader}>
                <AlertTriangle size={18} color={Colors.error} />
                <Text style={styles.dangerTitle}>Danger Zone</Text>
              </View>
              {summary.dangerWeeks.map((dw, i) => (
                <View key={i} style={styles.dangerRow}>
                  <Text style={styles.dangerDate}>
                    Week {dw.weekNumber} · {new Date(dw.weekDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </Text>
                  <Text style={styles.dangerBalance}>{formatCurrency(dw.balance)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {selectedWeekData && selectedWeek !== null && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              WEEK {selectedWeek + 1} DETAIL · {new Date(selectedWeekData.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Text>
            <View style={styles.weekDetailCard}>
              <View style={styles.weekDetailRow}>
                <View style={styles.weekDetailItem}>
                  <TrendingUp size={16} color={Colors.success} />
                  <Text style={styles.weekDetailLabel}>Income</Text>
                  <Text style={[styles.weekDetailValue, { color: Colors.success }]}>
                    {formatCurrency(selectedWeekData.totalIncome)}
                  </Text>
                </View>
                <View style={styles.weekDetailItem}>
                  <TrendingDown size={16} color={Colors.error} />
                  <Text style={styles.weekDetailLabel}>Expenses</Text>
                  <Text style={[styles.weekDetailValue, { color: Colors.error }]}>
                    {formatCurrency(selectedWeekData.totalExpenses)}
                  </Text>
                </View>
                <View style={styles.weekDetailItem}>
                  <Wallet size={16} color={Colors.info} />
                  <Text style={styles.weekDetailLabel}>Balance</Text>
                  <Text style={[styles.weekDetailValue, { color: selectedWeekData.runningBalance < 0 ? Colors.error : Colors.text }]}>
                    {formatCurrency(selectedWeekData.runningBalance)}
                  </Text>
                </View>
              </View>

              {selectedWeekData.incomeItems.length > 0 && (
                <View style={styles.weekItemsGroup}>
                  <Text style={styles.weekItemsLabel}>Income</Text>
                  {selectedWeekData.incomeItems.map((item, i) => (
                    <View key={i} style={styles.weekItemRow}>
                      <Text style={styles.weekItemName} numberOfLines={1}>{item.description}</Text>
                      <Text style={[styles.weekItemAmount, { color: Colors.success }]}>+{formatCurrency(item.amount)}</Text>
                    </View>
                  ))}
                </View>
              )}

              {selectedWeekData.expenseItems.length > 0 && (
                <View style={styles.weekItemsGroup}>
                  <Text style={styles.weekItemsLabel}>Expenses</Text>
                  {selectedWeekData.expenseItems.map((item, i) => (
                    <View key={i} style={styles.weekItemRow}>
                      <Text style={styles.weekItemName} numberOfLines={1}>{item.description}</Text>
                      <Text style={[styles.weekItemAmount, { color: Colors.error }]}>-{formatCurrency(item.amount)}</Text>
                    </View>
                  ))}
                </View>
              )}

              {selectedWeekData.incomeItems.length === 0 && selectedWeekData.expenseItems.length === 0 && (
                <Text style={styles.emptyWeekText}>No transactions this week</Text>
              )}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SUMMARY ({forecastWeeks} WEEKS)</Text>
          <View style={styles.summaryGrid}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryItemLabel}>Total Income</Text>
              <Text style={[styles.summaryItemValue, { color: Colors.success }]}>{formatCurrencyShort(summary.totalIncome)}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryItemLabel}>Total Expenses</Text>
              <Text style={[styles.summaryItemValue, { color: Colors.error }]}>{formatCurrencyShort(summary.totalExpenses)}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryItemLabel}>Net Profit</Text>
              <Text style={[styles.summaryItemValue, { color: summary.netProfit >= 0 ? Colors.success : Colors.error }]}>
                {formatCurrencyShort(summary.netProfit)}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryItemLabel}>Lowest Balance</Text>
              <Text style={[styles.summaryItemValue, { color: summary.lowestBalance < 0 ? Colors.error : Colors.text }]}>
                {formatCurrencyShort(summary.lowestBalance)}
              </Text>
              <Text style={styles.summaryItemSub}>Week {summary.lowestBalanceWeek}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <TouchableOpacity style={styles.sectionHeaderRow} onPress={() => toggleSection('expenses')} activeOpacity={0.7}>
            <DollarSign size={18} color={Colors.error} />
            <Text style={styles.sectionTitle}>Monthly Expenses</Text>
            <Text style={styles.sectionAmount}>{formatCurrencyShort(totalMonthlyExpenses)}/mo</Text>
            {expandedSections.expenses ? <ChevronUp size={18} color={Colors.textMuted} /> : <ChevronDown size={18} color={Colors.textMuted} />}
          </TouchableOpacity>

          {expandedSections.expenses && (
            <View style={styles.expandedContent}>
              {cashFlowData?.expenses.map(exp => (
                <View key={exp.id} style={styles.expenseListRow}>
                  <View style={styles.expenseListInfo}>
                    <Text style={styles.expenseListName}>{exp.name}</Text>
                    <Text style={styles.expenseListMeta}>{EXPENSE_CATEGORIES.find(c => c.value === exp.category)?.label} · {freqLabel(exp.frequency)}</Text>
                  </View>
                  <Text style={styles.expenseListAmount}>{formatCurrency(exp.amount)}</Text>
                  <TouchableOpacity onPress={() => handleRemoveExpense(exp.id)} style={styles.expenseDeleteBtn}>
                    <Trash2 size={14} color={Colors.error} />
                  </TouchableOpacity>
                </View>
              ))}
              {(!cashFlowData?.expenses || cashFlowData.expenses.length === 0) && (
                <Text style={styles.emptyListText}>No recurring expenses added yet</Text>
              )}
              <TouchableOpacity style={styles.addItemBtn} onPress={() => setShowAddExpense(true)} activeOpacity={0.7}>
                <Plus size={16} color={Colors.primary} />
                <Text style={styles.addItemText}>Add Expense</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <TouchableOpacity style={styles.sectionHeaderRow} onPress={() => toggleSection('income')} activeOpacity={0.7}>
            <TrendingUp size={18} color={Colors.success} />
            <Text style={styles.sectionTitle}>Expected Income</Text>
            <Text style={[styles.sectionAmount, { color: Colors.success }]}>
              {relevantInvoices.filter(i => i.status !== 'paid').length} pending
            </Text>
            {expandedSections.income ? <ChevronUp size={18} color={Colors.textMuted} /> : <ChevronDown size={18} color={Colors.textMuted} />}
          </TouchableOpacity>

          {expandedSections.income && (
            <View style={styles.expandedContent}>
              {relevantInvoices.filter(i => i.status !== 'paid').map(inv => {
                const remaining = inv.totalDue - inv.amountPaid;
                return (
                  <View key={inv.id} style={styles.incomeListRow}>
                    <View style={styles.incomeListInfo}>
                      <Text style={styles.incomeListName}>Invoice #{inv.number}</Text>
                      <Text style={styles.incomeListMeta}>
                        Due: {new Date(inv.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {inv.paymentTerms?.replace('_', ' ')}
                      </Text>
                    </View>
                    <Text style={styles.incomeListAmount}>{formatCurrency(remaining)}</Text>
                  </View>
                );
              })}

              {cashFlowData?.expectedPayments.map(ep => {
                const badge = confidenceBadge(ep.confidence);
                return (
                  <View key={ep.id} style={styles.incomeListRow}>
                    <View style={styles.incomeListInfo}>
                      <Text style={styles.incomeListName}>{ep.description}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.incomeListMeta}>
                          {new Date(ep.expectedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </Text>
                        <View style={[styles.confidenceBadge, { backgroundColor: badge.bg }]}>
                          <Text style={[styles.confidenceBadgeText, { color: badge.text }]}>{badge.label}</Text>
                        </View>
                      </View>
                    </View>
                    <Text style={styles.incomeListAmount}>{formatCurrency(ep.amount)}</Text>
                    <TouchableOpacity onPress={() => handleRemovePayment(ep.id)} style={styles.expenseDeleteBtn}>
                      <Trash2 size={14} color={Colors.error} />
                    </TouchableOpacity>
                  </View>
                );
              })}

              {relevantInvoices.filter(i => i.status !== 'paid').length === 0 && (!cashFlowData?.expectedPayments || cashFlowData.expectedPayments.length === 0) && (
                <Text style={styles.emptyListText}>No income expected. Add invoices or expected payments.</Text>
              )}
              <TouchableOpacity style={styles.addItemBtn} onPress={() => setShowAddPayment(true)} activeOpacity={0.7}>
                <Plus size={16} color={Colors.success} />
                <Text style={[styles.addItemText, { color: Colors.success }]}>Add Expected Payment</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <TouchableOpacity
            style={styles.aiButton}
            onPress={handleAIAnalysis}
            activeOpacity={0.85}
            disabled={aiLoading}
            testID="ai-analysis-btn"
          >
            {aiLoading ? (
              <ActivityIndicator size="small" color={Colors.textOnPrimary} />
            ) : (
              <Sparkles size={18} color={Colors.textOnPrimary} />
            )}
            <Text style={styles.aiButtonText}>
              {aiLoading ? 'Analyzing...' : 'Get AI Advice'}
            </Text>
          </TouchableOpacity>

          {showAiResults && aiAnalysis && (
            <View style={styles.aiResultsCard}>
              <View style={styles.aiResultsHeader}>
                <Sparkles size={16} color={Colors.primary} />
                <Text style={styles.aiResultsTitle}>AI Cash Flow Analysis</Text>
                <View style={[styles.healthBadge, { backgroundColor: healthColor(aiAnalysis.overallHealth) + '20' }]}>
                  <Text style={[styles.healthBadgeText, { color: healthColor(aiAnalysis.overallHealth) }]}>
                    {aiAnalysis.healthScore}/100
                  </Text>
                </View>
              </View>

              <Text style={styles.aiSummary}>{aiAnalysis.summary}</Text>

              {aiAnalysis.criticalWeeks.length > 0 && (
                <View style={styles.aiSection}>
                  <Text style={styles.aiSectionTitle}>Critical Weeks</Text>
                  {aiAnalysis.criticalWeeks.map((cw, i) => (
                    <View key={i} style={styles.criticalWeekRow}>
                      <AlertTriangle size={14} color={Colors.error} />
                      <Text style={styles.criticalWeekText}>
                        Week {cw.weekNumber}: {formatCurrency(cw.balance)} — {cw.problem}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {aiAnalysis.recommendations.length > 0 && (
                <View style={styles.aiSection}>
                  <Text style={styles.aiSectionTitle}>Recommendations</Text>
                  {aiAnalysis.recommendations.map((rec, i) => {
                    const pc = priorityConfig(rec.priority);
                    return (
                      <View key={i} style={[styles.recCard, { backgroundColor: pc.bg, borderColor: pc.text + '30' }]}>
                        <View style={styles.recHeader}>
                          <View style={[styles.recPriorityBadge, { backgroundColor: pc.text + '20' }]}>
                            <Text style={[styles.recPriorityText, { color: pc.text }]}>{rec.priority}</Text>
                          </View>
                          <View style={[styles.recDiffBadge, { backgroundColor: Colors.fillTertiary }]}>
                            <Text style={styles.recDiffText}>{rec.difficulty}</Text>
                          </View>
                        </View>
                        <Text style={styles.recAction}>{rec.action}</Text>
                        <Text style={styles.recImpact}>{rec.impact}</Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {aiAnalysis.billingOptimizations.length > 0 && (
                <View style={styles.aiSection}>
                  <Text style={styles.aiSectionTitle}>Billing Optimizations</Text>
                  {aiAnalysis.billingOptimizations.map((opt, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <CheckCircle size={14} color={Colors.success} />
                      <Text style={styles.bulletText}>{opt}</Text>
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.aiGenLabel}>✨ AI-generated</Text>
            </View>
          )}
        </View>
      </ScrollView>

      <CashFlowSetup
        visible={showSetup}
        onComplete={handleSetupComplete}
        onClose={() => setShowSetup(false)}
      />

      <Modal visible={showEditBalance} transparent animationType="fade" onRequestClose={() => setShowEditBalance(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Edit Balance</Text>
                <TouchableOpacity onPress={() => setShowEditBalance(false)}>
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalFieldLabel}>Current Bank Balance</Text>
              <View style={styles.modalInputRow}>
                <Text style={styles.modalDollar}>$</Text>
                <TextInput
                  style={styles.modalInput}
                  value={editBalanceValue}
                  onChangeText={setEditBalanceValue}
                  keyboardType="numeric"
                  autoFocus
                />
              </View>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleUpdateBalance} activeOpacity={0.85}>
                <Text style={styles.modalSaveBtnText}>Update Balance</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showAddExpense} transparent animationType="slide" onRequestClose={() => setShowAddExpense(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCardBottom, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Expense</Text>
                <TouchableOpacity onPress={() => setShowAddExpense(false)}>
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.modalFieldLabel}>Name</Text>
                <TextInput style={styles.modalTextInput} value={newExpenseName} onChangeText={setNewExpenseName} placeholder="e.g. Payroll" placeholderTextColor={Colors.textMuted} />
                <Text style={styles.modalFieldLabel}>Amount</Text>
                <View style={styles.modalInputRow}>
                  <Text style={styles.modalDollar}>$</Text>
                  <TextInput style={styles.modalInput} value={newExpenseAmount} onChangeText={setNewExpenseAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={Colors.textMuted} />
                </View>
                <Text style={styles.modalFieldLabel}>Frequency</Text>
                <View style={styles.chipGrid}>
                  {FREQUENCY_OPTIONS.map(opt => (
                    <TouchableOpacity key={opt.value} style={[styles.chip, newExpenseFrequency === opt.value && styles.chipActive]} onPress={() => setNewExpenseFrequency(opt.value)} activeOpacity={0.7}>
                      <Text style={[styles.chipText, newExpenseFrequency === opt.value && styles.chipTextActive]}>{opt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.modalFieldLabel}>Category</Text>
                <View style={styles.chipGrid}>
                  {EXPENSE_CATEGORIES.map(cat => (
                    <TouchableOpacity key={cat.value} style={[styles.chip, newExpenseCategory === cat.value && styles.chipActive]} onPress={() => setNewExpenseCategory(cat.value)} activeOpacity={0.7}>
                      <Text style={[styles.chipText, newExpenseCategory === cat.value && styles.chipTextActive]}>{cat.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleAddExpense} activeOpacity={0.85}>
                <Plus size={18} color={Colors.textOnPrimary} />
                <Text style={styles.modalSaveBtnText}>Add Expense</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showAddPayment} transparent animationType="slide" onRequestClose={() => setShowAddPayment(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCardBottom, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Expected Payment</Text>
                <TouchableOpacity onPress={() => setShowAddPayment(false)}>
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalFieldLabel}>Description</Text>
              <TextInput style={styles.modalTextInput} value={newPaymentDesc} onChangeText={setNewPaymentDesc} placeholder="e.g. Deposit from River Oak" placeholderTextColor={Colors.textMuted} />
              <Text style={styles.modalFieldLabel}>Amount</Text>
              <View style={styles.modalInputRow}>
                <Text style={styles.modalDollar}>$</Text>
                <TextInput style={styles.modalInput} value={newPaymentAmount} onChangeText={setNewPaymentAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={Colors.textMuted} />
              </View>
              <Text style={styles.modalFieldLabel}>Days from now</Text>
              <TextInput style={styles.modalTextInput} value={newPaymentDate} onChangeText={setNewPaymentDate} keyboardType="numeric" placeholder="30" placeholderTextColor={Colors.textMuted} />
              <Text style={styles.modalFieldLabel}>Confidence</Text>
              <View style={styles.chipGrid}>
                {(['confirmed', 'expected', 'hopeful'] as const).map(c => {
                  const badge = confidenceBadge(c);
                  return (
                    <TouchableOpacity key={c} style={[styles.chip, newPaymentConfidence === c && { backgroundColor: badge.bg, borderColor: badge.text + '30', borderWidth: 1 }]} onPress={() => setNewPaymentConfidence(c)} activeOpacity={0.7}>
                      <Text style={[styles.chipText, newPaymentConfidence === c && { color: badge.text }]}>{badge.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity style={[styles.modalSaveBtn, { backgroundColor: Colors.success }]} onPress={handleAddPayment} activeOpacity={0.85}>
                <Plus size={18} color={Colors.textOnPrimary} />
                <Text style={styles.modalSaveBtnText}>Add Payment</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  heroCard: { marginHorizontal: 16, marginTop: 16, backgroundColor: Colors.primary, borderRadius: 20, padding: 20, gap: 16 },
  heroRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroLeft: { gap: 4 },
  heroLabel: { fontSize: 13, fontWeight: '600' as const, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  heroAmount: { fontSize: 32, fontWeight: '800' as const, color: '#FFFFFF', letterSpacing: -1 },
  editBalanceBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  editBalanceBtnText: { fontSize: 13, fontWeight: '600' as const, color: '#FFFFFF' },
  forecastSelector: { flexDirection: 'row', gap: 6 },
  forecastChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.15)' },
  forecastChipActive: { backgroundColor: '#FFFFFF' },
  forecastChipText: { fontSize: 12, fontWeight: '600' as const, color: 'rgba(255,255,255,0.8)' },
  forecastChipTextActive: { color: Colors.primary },
  section: { marginHorizontal: 16, marginTop: 20 },
  sectionLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase' as const, marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.cardBorder },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  sectionAmount: { fontSize: 14, fontWeight: '700' as const, color: Colors.error, marginRight: 4 },
  expandedContent: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginTop: 6, borderWidth: 1, borderColor: Colors.cardBorder, gap: 8 },
  expenseListRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  expenseListInfo: { flex: 1, gap: 2 },
  expenseListName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  expenseListMeta: { fontSize: 12, color: Colors.textMuted },
  expenseListAmount: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  expenseDeleteBtn: { padding: 6 },
  incomeListRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  incomeListInfo: { flex: 1, gap: 2 },
  incomeListName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  incomeListMeta: { fontSize: 12, color: Colors.textMuted },
  incomeListAmount: { fontSize: 14, fontWeight: '700' as const, color: Colors.success },
  confidenceBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  confidenceBadgeText: { fontSize: 10, fontWeight: '700' as const },
  emptyListText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', paddingVertical: 12 },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginTop: 4 },
  addItemText: { fontSize: 14, fontWeight: '600' as const, color: Colors.primary },
  dangerCard: { backgroundColor: Colors.errorLight, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.error + '30', gap: 10 },
  dangerHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dangerTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.error },
  dangerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingLeft: 26 },
  dangerDate: { fontSize: 13, color: Colors.textSecondary },
  dangerBalance: { fontSize: 14, fontWeight: '700' as const, color: Colors.error },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryItem: { flex: 1, minWidth: '45%' as any, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.cardBorder, gap: 4 },
  summaryItemLabel: { fontSize: 12, color: Colors.textMuted, fontWeight: '500' as const },
  summaryItemValue: { fontSize: 18, fontWeight: '800' as const, color: Colors.text },
  summaryItemSub: { fontSize: 11, color: Colors.textMuted },
  weekDetailCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.cardBorder },
  weekDetailRow: { flexDirection: 'row', gap: 8 },
  weekDetailItem: { flex: 1, alignItems: 'center', backgroundColor: Colors.surfaceAlt, borderRadius: 10, padding: 10, gap: 4 },
  weekDetailLabel: { fontSize: 11, fontWeight: '500' as const, color: Colors.textMuted },
  weekDetailValue: { fontSize: 16, fontWeight: '800' as const },
  weekItemsGroup: { marginTop: 12, gap: 4 },
  weekItemsLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textMuted, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  weekItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  weekItemName: { flex: 1, fontSize: 13, color: Colors.text, marginRight: 8 },
  weekItemAmount: { fontSize: 13, fontWeight: '700' as const },
  emptyWeekText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', paddingVertical: 16 },
  aiButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 3 },
  aiButtonText: { fontSize: 16, fontWeight: '700' as const, color: Colors.textOnPrimary },
  aiResultsCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginTop: 12, borderWidth: 1, borderColor: Colors.cardBorder, gap: 12 },
  aiResultsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiResultsTitle: { flex: 1, fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  healthBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  healthBadgeText: { fontSize: 13, fontWeight: '700' as const },
  aiSummary: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  aiSection: { gap: 8, marginTop: 4 },
  aiSectionTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.text, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  criticalWeekRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  criticalWeekText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  recCard: { borderRadius: 12, padding: 12, borderWidth: 1, gap: 6 },
  recHeader: { flexDirection: 'row', gap: 6 },
  recPriorityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  recPriorityText: { fontSize: 10, fontWeight: '700' as const, textTransform: 'uppercase' as const },
  recDiffBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  recDiffText: { fontSize: 10, fontWeight: '600' as const, color: Colors.textMuted, textTransform: 'uppercase' as const },
  recAction: { fontSize: 14, fontWeight: '600' as const, color: Colors.text, lineHeight: 19 },
  recImpact: { fontSize: 12, color: Colors.textSecondary },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bulletText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  aiGenLabel: { fontSize: 11, color: Colors.textMuted, textAlign: 'right', marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 20, gap: 12 },
  modalCardBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, maxHeight: '80%', gap: 10 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  modalFieldLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 8 },
  modalInputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceAlt, borderRadius: 12, paddingHorizontal: 12 },
  modalDollar: { fontSize: 20, fontWeight: '800' as const, color: Colors.primary },
  modalInput: { flex: 1, minHeight: 48, fontSize: 20, fontWeight: '700' as const, color: Colors.text, paddingHorizontal: 8 },
  modalTextInput: { minHeight: 44, borderRadius: 12, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: 15, color: Colors.text },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.fillTertiary },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  chipTextActive: { color: Colors.textOnPrimary },
  modalSaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, marginTop: 12 },
  modalSaveBtnText: { fontSize: 16, fontWeight: '700' as const, color: Colors.textOnPrimary },
});
