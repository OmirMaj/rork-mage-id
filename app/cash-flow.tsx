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
  AlertTriangle, CheckCircle, ChevronDown, ChevronUp,
  Calendar, Clock, Wallet, BarChart3, RefreshCw,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import ConstructionLoader from '@/components/ConstructionLoader';
import { useProjects } from '@/contexts/ProjectContext';
import CashFlowChart from '@/components/CashFlowChart';
import { FeatureHeader } from '@/components/FeatureHeader';
import CashFlowSetup from '@/components/CashFlowSetup';
import TapeRollNumber from '@/components/animations/TapeRollNumber';
import ConcretePour from '@/components/animations/ConcretePour';
import {
  generateForecast, calculateSummary, formatCurrency, formatCurrencyShort,
  getEffectiveStartingBalance,
} from '@/utils/cashFlowEngine';
import type { CashFlowExpense, ExpectedPayment, CashFlowWeek, CashFlowSummary, ExpenseCategory, ExpenseFrequency } from '@/utils/cashFlowEngine';
import {
  loadCashFlowData, saveCashFlowData, isSetupComplete, markSetupComplete,
  getCachedAIAnalysis, setCachedAIAnalysis,
} from '@/utils/cashFlowStorage';
import type { CashFlowData } from '@/utils/cashFlowStorage';
import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// Gemini occasionally swaps shapes — returning strings where objects are expected
// or vice versa. These preprocess coercers normalize the payload so the UI never
// crashes on a bad shape.
const coerceStringArray = z.preprocess(
  (v) => {
    if (Array.isArray(v)) {
      return v.map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          // Pull a sensible string out of {action, description, ...}
          const obj = item as Record<string, unknown>;
          return String(obj.action ?? obj.description ?? obj.text ?? obj.title ?? JSON.stringify(obj));
        }
        return String(item ?? '');
      });
    }
    if (typeof v === 'string') return [v];
    if (v && typeof v === 'object') return Object.values(v).map((x) => String(x));
    return [];
  },
  z.array(z.string()).default([]),
);

const recommendationItemSchema = z.preprocess(
  (v) => {
    if (typeof v === 'string') {
      // Model returned a plain string — wrap it as an object.
      return { priority: 'important', action: v, impact: '', difficulty: 'moderate' };
    }
    return v;
  },
  z.object({
    priority: z.enum(['urgent', 'important', 'suggestion']).catch('important').default('important'),
    action: z.string().catch('').default(''),
    impact: z.string().catch('').default(''),
    difficulty: z.enum(['easy', 'moderate', 'hard']).catch('moderate').default('moderate'),
  }),
);

const cashFlowAnalysisSchema = z.object({
  overallHealth: z.enum(['healthy', 'caution', 'danger']).catch('caution').default('caution'),
  healthScore: z.number().catch(50).default(50),
  criticalWeeks: z.array(z.object({
    weekNumber: z.number().catch(0).default(0),
    weekDate: z.string().catch('').default(''),
    balance: z.number().catch(0).default(0),
    problem: z.string().catch('').default(''),
  })).default([]),
  recommendations: z.array(recommendationItemSchema).default([]),
  billingOptimizations: coerceStringArray,
  expenseReductions: coerceStringArray,
  summary: z.string().default(''),
});

type AIAnalysis = z.infer<typeof cashFlowAnalysisSchema>;

const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'payroll', label: 'Payroll' },
  { value: 'materials', label: 'Materials' },
  { value: 'equipment_rental', label: 'Equipment Rental' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'overhead', label: 'Overhead' },
  { value: 'loan', label: 'Loan/Financing' },
  { value: 'other', label: 'Other' },
];

const FREQUENCY_OPTIONS: { value: ExpenseFrequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'one_time', label: 'One-time' },
];

const FORECAST_OPTIONS = [
  { weeks: 4, label: '4w' },
  { weeks: 8, label: '8w' },
  { weeks: 12, label: '12w' },
  { weeks: 24, label: '6mo' },
  { weeks: 52, label: '1yr' },
];

const MIN_FORECAST_WEEKS = 1;
const MAX_FORECAST_WEEKS = 260; // 5 years — plenty of headroom for long projects.

export default function CashFlowScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('cash_flow_forecaster')) {
    return (
      <Paywall
        visible={true}
        feature="Cash Flow Forecaster"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <CashFlowScreenInner />;
}

function CashFlowScreenInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, invoices: allInvoices, getInvoicesForProject, changeOrders: allChangeOrders, getChangeOrdersForProject } = useProjects();

  const [loading, setLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [cashFlowData, setCashFlowData] = useState<CashFlowData | null>(null);
  const [forecastWeeks, setForecastWeeks] = useState(12);
  const [customWeeksInput, setCustomWeeksInput] = useState('');
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

  const relevantChangeOrders = useMemo(() => {
    if (projectId) return getChangeOrdersForProject(projectId);
    return allChangeOrders;
  }, [projectId, allChangeOrders, getChangeOrdersForProject]);

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

  const effectiveStartingBalance = useMemo<number>(() => {
    if (!cashFlowData) return 0;
    return getEffectiveStartingBalance(
      cashFlowData.startingBalance,
      cashFlowData.balanceAsOf,
      relevantInvoices,
    );
  }, [cashFlowData, relevantInvoices]);

  const forecast = useMemo<CashFlowWeek[]>(() => {
    if (!cashFlowData) return [];
    return generateForecast(
      effectiveStartingBalance,
      cashFlowData.expenses,
      relevantInvoices,
      cashFlowData.expectedPayments,
      forecastWeeks,
      cashFlowData.defaultPaymentTerms,
      relevantChangeOrders,
    );
  }, [cashFlowData, effectiveStartingBalance, relevantInvoices, relevantChangeOrders, forecastWeeks]);

  const summary = useMemo<CashFlowSummary>(() => calculateSummary(forecast), [forecast]);

  // Derive a one-glance health status from the forecast. Used by the hero
  // pill so a contractor can see "Healthy / Watch / Danger" without having
  // to scan numbers. Three buckets:
  //   • Danger   — balance goes negative at any point in the horizon
  //   • Watch    — net profit < 0 over horizon, but balance stays positive
  //   • Healthy  — net profit >= 0 and balance stays positive
  const healthStatus = useMemo(() => {
    if (forecast.length === 0) return { kind: 'neutral' as const, label: 'Setup', color: themeColors.textSecondary, bg: 'rgba(255,255,255,0.18)' };
    if (summary.lowestBalance < 0) return { kind: 'danger' as const, label: 'Danger', color: '#FFE0E0', bg: 'rgba(255,90,90,0.35)' };
    if (summary.netProfit < 0) return { kind: 'watch' as const, label: 'Watch', color: '#FFEBC2', bg: 'rgba(255,180,60,0.35)' };
    return { kind: 'healthy' as const, label: 'Healthy', color: '#D6FFE3', bg: 'rgba(80,220,140,0.35)' };
  }, [forecast.length, summary.lowestBalance, summary.netProfit]);

  // Aggregate "Total Pending" across every source of expected money that hasn't landed:
  //   - unpaid invoice balances (totalDue - amountPaid)
  //   - manually-entered expected payments
  //   - approved change orders not yet rolled into an invoice
  // Used for the Expected Income header so the GC can see the real dollar figure,
  // not just a "3 pending" count.
  const totalPending = useMemo(() => {
    const invoiceTotal = relevantInvoices
      .filter(i => i.status !== 'paid')
      .reduce((sum, i) => sum + Math.max(0, (i.totalDue ?? 0) - (i.amountPaid ?? 0)), 0);
    const expectedTotal = (cashFlowData?.expectedPayments ?? [])
      .reduce((sum, p) => sum + (p.amount ?? 0), 0);
    const changeOrderTotal = relevantChangeOrders
      .filter(co => co.status === 'approved')
      .reduce((sum, co) => sum + (co.changeAmount ?? 0), 0);
    return invoiceTotal + expectedTotal + changeOrderTotal;
  }, [relevantInvoices, cashFlowData?.expectedPayments, relevantChangeOrders]);

  const pendingCount = useMemo(() => {
    const inv = relevantInvoices.filter(i => i.status !== 'paid').length;
    const exp = (cashFlowData?.expectedPayments ?? []).length;
    const co = relevantChangeOrders.filter(c => c.status === 'approved').length;
    return inv + exp + co;
  }, [relevantInvoices, cashFlowData?.expectedPayments, relevantChangeOrders]);

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
    // Stamp balanceAsOf so future invoice payments can be auto-added on top of
    // this balance without the GC having to manually re-edit every time a check clears.
    const updated = { ...cashFlowData, startingBalance: bal, balanceAsOf: new Date().toISOString() };
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
        maxTokens: 3500,
      });
      if (!aiResult.success) {
        Alert.alert('AI Unavailable', aiResult.error || 'Try again.');
        return;
      }
      setAiAnalysis(aiResult.data);
      await setCachedAIAnalysis(aiResult.data, projectId);
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
      case 'confirmed': return { bg: themeColors.successSoft, text: themeColors.success, label: 'Confirmed' };
      case 'expected': return { bg: themeColors.info, text: themeColors.info, label: 'Expected' };
      default: return { bg: themeColors.accentSoft, text: themeColors.accent, label: 'Hopeful' };
    }
  };

  const healthColor = (health: string) => {
    switch (health) {
      case 'healthy': return themeColors.success;
      case 'caution': return themeColors.accent;
      default: return themeColors.danger;
    }
  };

  const priorityConfig = (p: string) => {
    switch (p) {
      case 'urgent': return { bg: themeColors.danger, text: themeColors.danger };
      case 'important': return { bg: themeColors.accentSoft, text: themeColors.accent };
      default: return { bg: themeColors.info, text: themeColors.info };
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Cash Flow' }} />
        <ConstructionLoader size="lg" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{
        title: projectId ? 'Project Cash Flow' : 'Cash Flow Forecast',
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: themeColors.accent,
        headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text },
        headerRight: () => (
          <TouchableOpacity
            onPress={() => setShowSetup(true)}
            style={{ padding: 6 }}
            activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Edit">
            <Edit3 size={20} color={themeColors.accent} strokeWidth={1.75} />
          </TouchableOpacity>
        ),
      }} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <FeatureHeader
          eyebrow="Cash Flow"
          title="When will money come in?"
          subtitle="A 12-week chart of expected draws and bills across your projects. We use your invoices, scheduled draws, and payroll to project the next quarter."
          explainer={{
            term: 'Cash Flow Forecast',
            definition: 'A cash flow forecast projects when money will arrive (draws from owners, deposits, paid invoices) and when it will leave (sub payments, payroll, materials). The gap between income and outflow each week tells you whether you can cover this Friday\'s payroll or need to chase a draw.',
            whenToUse: [
              'Before agreeing to a payment schedule with a new owner',
              'When you\'re weighing whether to take on another project',
              'Weekly, to spot a payroll-week shortfall a month early',
            ],
          }}
        />
        <View style={styles.heroCard}>
          {/* Decorative gradient layers — three semi-transparent circles
              positioned to give the hero a rich, premium gradient feel
              without depending on a linear-gradient native module. */}
          <View pointerEvents="none" style={styles.heroGlowA} />
          <View pointerEvents="none" style={styles.heroGlowB} />

          <View style={styles.heroRow}>
            <View style={styles.heroLeft}>
              <View style={styles.heroLabelRow}>
                <Wallet size={12} color="rgba(255,255,255,0.85)" strokeWidth={1.75} />
                <Text style={styles.heroLabel}>
                  Current Balance
                  {effectiveStartingBalance !== (cashFlowData?.startingBalance ?? 0) ? ' · auto' : ''}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setEditBalanceValue(cashFlowData?.startingBalance?.toString() ?? '0');
                  setShowEditBalance(true);
                }}
                activeOpacity={0.75}
                testID="hero-balance-tap"
              >
                {/* Animated number ticker — counts from prior value to
                    current on mount and on changes. Big, premium feel. */}
                <TapeRollNumber
                  value={effectiveStartingBalance}
                  prefix="$"
                  decimals={0}
                  duration={650}
                  style={styles.heroAmount}
                />
              </TouchableOpacity>
              {/* Status pill + projected end-of-horizon delta */}
              <View style={styles.heroSubRow}>
                <View style={[styles.heroStatusPill, { backgroundColor: healthStatus.bg }]}>
                  {healthStatus.kind === 'healthy' && <CheckCircle size={11} color={healthStatus.color} strokeWidth={1.75} />}
                  {healthStatus.kind === 'watch' && <AlertTriangle size={11} color={healthStatus.color} strokeWidth={1.75} />}
                  {healthStatus.kind === 'danger' && <AlertTriangle size={11} color={healthStatus.color} strokeWidth={1.75} />}
                  <Text style={[styles.heroStatusText, { color: healthStatus.color }]}>{healthStatus.label}</Text>
                </View>
                {forecast.length > 0 && (
                  <View style={styles.heroDelta}>
                    {summary.netProfit >= 0 ? (
                      <TrendingUp size={11} color="#D6FFE3" strokeWidth={1.75} />
                    ) : (
                      <TrendingDown size={11} color="#FFE0E0" strokeWidth={1.75} />
                    )}
                    <Text style={[styles.heroDeltaText, { color: summary.netProfit >= 0 ? '#D6FFE3' : '#FFE0E0' }]}>
                      {summary.netProfit >= 0 ? '+' : ''}{formatCurrencyShort(summary.netProfit)} · {forecastWeeks}w
                    </Text>
                  </View>
                )}
              </View>
            </View>
            <TouchableOpacity
              style={styles.editBalanceBtn}
              onPress={() => {
                setEditBalanceValue(cashFlowData?.startingBalance?.toString() ?? '0');
                setShowEditBalance(true);
              }}
              activeOpacity={0.75} accessibilityRole="button" accessibilityLabel="Edit">
              <Edit3 size={14} color={themeColors.surface} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>

          <View style={styles.forecastSelector}>
            {FORECAST_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.weeks}
                style={[styles.forecastChip, forecastWeeks === opt.weeks && styles.forecastChipActive]}
                onPress={() => {
                  setForecastWeeks(opt.weeks);
                  setCustomWeeksInput('');
                  setSelectedWeek(null);
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.forecastChipText, forecastWeeks === opt.weeks && styles.forecastChipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
            <View style={styles.customWeeksChip}>
              <TextInput
                style={styles.customWeeksInput}
                value={customWeeksInput}
                onChangeText={(text) => {
                  const cleaned = text.replace(/[^0-9]/g, '').slice(0, 3);
                  setCustomWeeksInput(cleaned);
                  const n = parseInt(cleaned, 10);
                  if (!isNaN(n) && n >= MIN_FORECAST_WEEKS && n <= MAX_FORECAST_WEEKS) {
                    setForecastWeeks(n);
                    setSelectedWeek(null);
                  }
                }}
                placeholder="#"
                placeholderTextColor="rgba(255,255,255,0.5)"
                keyboardType="number-pad"
                maxLength={3}
                returnKeyType="done"
              />
              <Text style={styles.customWeeksLabel}>wks</Text>
            </View>
          </View>

          <View style={styles.pendingRow}>
            <View style={styles.pendingItem}>
              <Text style={styles.pendingLabel}>Total Pending</Text>
              <Text style={styles.pendingValue}>{formatCurrency(totalPending)}</Text>
            </View>
            <View style={styles.pendingDivider} />
            <View style={styles.pendingItem}>
              <Text style={styles.pendingLabel}>Sources</Text>
              <Text style={styles.pendingValue}>{pendingCount}</Text>
            </View>
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
                <AlertTriangle size={18} color={themeColors.danger} strokeWidth={1.75} />
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
                  <TrendingUp size={16} color={themeColors.success} strokeWidth={1.75} />
                  <Text style={styles.weekDetailLabel}>Income</Text>
                  <Text style={[styles.weekDetailValue, { color: themeColors.success }]}>
                    {formatCurrency(selectedWeekData.totalIncome)}
                  </Text>
                </View>
                <View style={styles.weekDetailItem}>
                  <TrendingDown size={16} color={themeColors.danger} strokeWidth={1.75} />
                  <Text style={styles.weekDetailLabel}>Expenses</Text>
                  <Text style={[styles.weekDetailValue, { color: themeColors.danger }]}>
                    {formatCurrency(selectedWeekData.totalExpenses)}
                  </Text>
                </View>
                <View style={styles.weekDetailItem}>
                  <Wallet size={16} color={themeColors.info} strokeWidth={1.75} />
                  <Text style={styles.weekDetailLabel}>Balance</Text>
                  <Text style={[styles.weekDetailValue, { color: selectedWeekData.runningBalance < 0 ? themeColors.danger : themeColors.text }]}>
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
                      <Text style={[styles.weekItemAmount, { color: themeColors.success }]}>+{formatCurrency(item.amount)}</Text>
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
                      <Text style={[styles.weekItemAmount, { color: themeColors.danger }]}>-{formatCurrency(item.amount)}</Text>
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
            <View style={[styles.summaryItem, { borderLeftColor: themeColors.success, borderLeftWidth: 3 }]}>
              <View style={styles.summaryIconWrap}>
                <View style={[styles.summaryIcon, { backgroundColor: themeColors.success + '15' }]}>
                  <TrendingUp size={14} color={themeColors.success} strokeWidth={1.75} />
                </View>
              </View>
              <Text style={styles.summaryItemLabel}>Total Income</Text>
              <Text style={[styles.summaryItemValue, { color: themeColors.success }]}>{formatCurrencyShort(summary.totalIncome)}</Text>
            </View>
            <View style={[styles.summaryItem, { borderLeftColor: themeColors.danger, borderLeftWidth: 3 }]}>
              <View style={styles.summaryIconWrap}>
                <View style={[styles.summaryIcon, { backgroundColor: themeColors.danger + '15' }]}>
                  <TrendingDown size={14} color={themeColors.danger} strokeWidth={1.75} />
                </View>
              </View>
              <Text style={styles.summaryItemLabel}>Total Expenses</Text>
              <Text style={[styles.summaryItemValue, { color: themeColors.danger }]}>{formatCurrencyShort(summary.totalExpenses)}</Text>
            </View>
            <View style={[styles.summaryItem, { borderLeftColor: summary.netProfit >= 0 ? themeColors.success : themeColors.danger, borderLeftWidth: 3 }]}>
              <View style={styles.summaryIconWrap}>
                <View style={[styles.summaryIcon, { backgroundColor: (summary.netProfit >= 0 ? themeColors.success : themeColors.danger) + '15' }]}>
                  <DollarSign size={14} color={summary.netProfit >= 0 ? themeColors.success : themeColors.danger} strokeWidth={1.75} />
                </View>
              </View>
              <Text style={styles.summaryItemLabel}>Net Profit</Text>
              <Text style={[styles.summaryItemValue, { color: summary.netProfit >= 0 ? themeColors.success : themeColors.danger }]}>
                {formatCurrencyShort(summary.netProfit)}
              </Text>
              {/* Tiny progress bar showing income coverage of expenses */}
              {summary.totalIncome > 0 && (
                <ConcretePour
                  value={Math.min(1, summary.totalIncome / Math.max(summary.totalExpenses, 1))}
                  height={3}
                  fillColor={summary.netProfit >= 0 ? themeColors.success : themeColors.danger}
                  duration={1200}
                  style={{ marginTop: 6 }}
                />
              )}
            </View>
            <View style={[styles.summaryItem, { borderLeftColor: summary.lowestBalance < 0 ? themeColors.danger : themeColors.info, borderLeftWidth: 3 }]}>
              <View style={styles.summaryIconWrap}>
                <View style={[styles.summaryIcon, { backgroundColor: (summary.lowestBalance < 0 ? themeColors.danger : themeColors.info) + '15' }]}>
                  <Wallet size={14} color={summary.lowestBalance < 0 ? themeColors.danger : themeColors.info} strokeWidth={1.75} />
                </View>
              </View>
              <Text style={styles.summaryItemLabel}>Lowest Balance</Text>
              <Text style={[styles.summaryItemValue, { color: summary.lowestBalance < 0 ? themeColors.danger : themeColors.text }]}>
                {formatCurrencyShort(summary.lowestBalance)}
              </Text>
              <Text style={styles.summaryItemSub}>Week {summary.lowestBalanceWeek}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <TouchableOpacity style={styles.sectionHeaderRow} onPress={() => toggleSection('expenses')} activeOpacity={0.7}>
            <DollarSign size={18} color={themeColors.danger} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>Monthly Expenses</Text>
            <Text style={styles.sectionAmount}>{formatCurrencyShort(totalMonthlyExpenses)}/mo</Text>
            {expandedSections.expenses ? <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} /> : <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />}
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
                  <TouchableOpacity onPress={() => handleRemoveExpense(exp.id)} style={styles.expenseDeleteBtn} accessibilityRole="button" accessibilityLabel="Delete">
                    <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
              ))}
              {(!cashFlowData?.expenses || cashFlowData.expenses.length === 0) && (
                <Text style={styles.emptyListText}>No recurring expenses added yet</Text>
              )}
              <TouchableOpacity style={styles.addItemBtn} onPress={() => setShowAddExpense(true)} activeOpacity={0.7}>
                <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.addItemText}>Add Expense</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <TouchableOpacity style={styles.sectionHeaderRow} onPress={() => toggleSection('income')} activeOpacity={0.7}>
            <TrendingUp size={18} color={themeColors.success} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>Expected Income</Text>
            <Text style={[styles.sectionAmount, { color: themeColors.success }]}>
              {formatCurrencyShort(totalPending)} pending
            </Text>
            {expandedSections.income ? <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} /> : <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />}
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
                    <TouchableOpacity onPress={() => handleRemovePayment(ep.id)} style={styles.expenseDeleteBtn} accessibilityRole="button" accessibilityLabel="Delete">
                      <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                    </TouchableOpacity>
                  </View>
                );
              })}

              {relevantInvoices.filter(i => i.status !== 'paid').length === 0 && (!cashFlowData?.expectedPayments || cashFlowData.expectedPayments.length === 0) && (
                <Text style={styles.emptyListText}>No income expected. Add invoices or expected payments.</Text>
              )}
              <TouchableOpacity style={styles.addItemBtn} onPress={() => setShowAddPayment(true)} activeOpacity={0.7}>
                <Plus size={16} color={themeColors.success} strokeWidth={1.75} />
                <Text style={[styles.addItemText, { color: themeColors.success }]}>Add Expected Payment</Text>
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
              <ActivityIndicator size="small" color={"#FFFFFF"} />
            ) : (
              <MageAIMark size={18} color={"#FFFFFF"} />
            )}
            <Text style={styles.aiButtonText}>
              {aiLoading ? 'Analyzing...' : 'Get AI Advice'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.aiButton, { backgroundColor: themeColors.accent, marginTop: 10 }]}
            onPress={() => router.push({ pathname: '/payment-predictions' as any, params: projectId ? { projectId } : {} })}
            activeOpacity={0.85}
            testID="payment-forecast-btn"
          >
            <TrendingUp size={18} color={"#FFFFFF"} strokeWidth={1.75} />
            <Text style={styles.aiButtonText}>Payment Forecast</Text>
          </TouchableOpacity>

          {showAiResults && aiAnalysis && (
            <View style={styles.aiResultsCard}>
              <View style={styles.aiResultsHeader}>
                <MageAIMark size={16} color={themeColors.accent} />
                <Text style={styles.aiResultsTitle}>AI Cash Flow Analysis</Text>
                <View style={[styles.healthBadge, { backgroundColor: healthColor(aiAnalysis.overallHealth) + '20' }]}>
                  <Text style={[styles.healthBadgeText, { color: healthColor(aiAnalysis.overallHealth) }]}>
                    {aiAnalysis.healthScore}/100
                  </Text>
                </View>
              </View>

              <Text style={styles.aiSummary}>{aiAnalysis.summary}</Text>

              {(aiAnalysis.criticalWeeks ?? []).length > 0 && (
                <View style={styles.aiSection}>
                  <Text style={styles.aiSectionTitle}>Critical Weeks</Text>
                  {(aiAnalysis.criticalWeeks ?? []).map((cw, i) => (
                    <View key={i} style={styles.criticalWeekRow}>
                      <AlertTriangle size={14} color={themeColors.danger} strokeWidth={1.75} />
                      <Text style={styles.criticalWeekText}>
                        Week {cw.weekNumber}: {formatCurrency(cw.balance)} — {cw.problem}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {(aiAnalysis.recommendations ?? []).length > 0 && (
                <View style={styles.aiSection}>
                  <Text style={styles.aiSectionTitle}>Recommendations</Text>
                  {(aiAnalysis.recommendations ?? []).map((rec, i) => {
                    const pc = priorityConfig(rec.priority);
                    return (
                      <View key={i} style={[styles.recCard, { backgroundColor: pc.bg, borderColor: pc.text + '30' }]}>
                        <View style={styles.recHeader}>
                          <View style={[styles.recPriorityBadge, { backgroundColor: pc.text + '20' }]}>
                            <Text style={[styles.recPriorityText, { color: pc.text }]}>{rec.priority}</Text>
                          </View>
                          <View style={[styles.recDiffBadge, { backgroundColor: themeColors.line }]}>
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

              {(aiAnalysis.billingOptimizations ?? []).length > 0 && (
                <View style={styles.aiSection}>
                  <Text style={styles.aiSectionTitle}>Billing Optimizations</Text>
                  {(aiAnalysis.billingOptimizations ?? []).map((opt, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <CheckCircle size={14} color={themeColors.success} strokeWidth={1.75} />
                      <Text style={styles.bulletText}>{opt}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <MageAIMark size={12} color={themeColors.accent} />
                <Text style={styles.aiGenLabel}>AI-generated</Text>
              </View>
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
                <TouchableOpacity onPress={() => setShowEditBalance(false)} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
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
                <TouchableOpacity onPress={() => setShowAddExpense(false)} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.modalFieldLabel}>Name</Text>
                <TextInput style={styles.modalTextInput} value={newExpenseName} onChangeText={setNewExpenseName} placeholder="e.g. Payroll" placeholderTextColor={themeColors.textMuted} />
                <Text style={styles.modalFieldLabel}>Amount</Text>
                <View style={styles.modalInputRow}>
                  <Text style={styles.modalDollar}>$</Text>
                  <TextInput style={styles.modalInput} value={newExpenseAmount} onChangeText={setNewExpenseAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={themeColors.textMuted} />
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
                <Plus size={18} color={"#FFFFFF"} strokeWidth={1.75} />
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
                <TouchableOpacity onPress={() => setShowAddPayment(false)} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalFieldLabel}>Description</Text>
              <TextInput style={styles.modalTextInput} value={newPaymentDesc} onChangeText={setNewPaymentDesc} placeholder="e.g. Deposit from River Oak" placeholderTextColor={themeColors.textMuted} />
              <Text style={styles.modalFieldLabel}>Amount</Text>
              <View style={styles.modalInputRow}>
                <Text style={styles.modalDollar}>$</Text>
                <TextInput style={styles.modalInput} value={newPaymentAmount} onChangeText={setNewPaymentAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={themeColors.textMuted} />
              </View>
              <Text style={styles.modalFieldLabel}>Days from now</Text>
              <TextInput style={styles.modalTextInput} value={newPaymentDate} onChangeText={setNewPaymentDate} keyboardType="numeric" placeholder="30" placeholderTextColor={themeColors.textMuted} />
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
              <TouchableOpacity style={[styles.modalSaveBtn, { backgroundColor: themeColors.success }]} onPress={handleAddPayment} activeOpacity={0.85}>
                <Plus size={18} color={"#FFFFFF"} strokeWidth={1.75} />
                <Text style={styles.modalSaveBtnText}>Add Payment</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  heroCard: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: themeColors.accent,
    borderRadius: Tokens.radius["2xl"],
    padding: 22,
    gap: 18,
    overflow: 'hidden' as const,
    shadowColor: themeColors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 6,
  },
  // Soft gradient orbs to give the hero depth without a gradient lib.
  heroGlowA: { position: 'absolute' as const, top: -60, right: -60, width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255,255,255,0.12)' },
  heroGlowB: { position: 'absolute' as const, bottom: -80, left: -40, width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(0,0,0,0.10)' },
  heroRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', zIndex: 1 },
  heroLeft: { gap: 6, flex: 1 },
  heroLabelRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  heroLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase' as const, letterSpacing: 1 },
  heroAmount: { fontSize: 38, fontWeight: '800' as const, color: themeColors.surface, letterSpacing: -1.2 },
  heroSubRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 4 },
  heroStatusPill: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.card },
  heroStatusText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, letterSpacing: 0.3 },
  heroDelta: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.card, backgroundColor: 'rgba(255,255,255,0.15)' },
  heroDeltaText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, letterSpacing: 0.2 },
  editBalanceBtn: { width: 32, height: 32, borderRadius: Tokens.radius.panel, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: 'rgba(255,255,255,0.2)' },
  editBalanceBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.surface },
  forecastSelector: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6 },
  forecastChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: 'rgba(255,255,255,0.15)' },
  forecastChipActive: { backgroundColor: '#FFFFFF' },
  forecastChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: 'rgba(255,255,255,0.8)' },
  forecastChipTextActive: { color: themeColors.accent },
  customWeeksChip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  customWeeksInput: { minWidth: 34, paddingVertical: 0, paddingHorizontal: 2, fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.surface, textAlign: 'center' as const },
  customWeeksLabel: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: 'rgba(255,255,255,0.8)' },
  pendingRow: { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: Tokens.radius.card, paddingVertical: 10, paddingHorizontal: 14, gap: 14 },
  pendingItem: { flex: 1, gap: 2 },
  pendingLabel: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  pendingValue: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: themeColors.surface, letterSpacing: -0.3 },
  pendingDivider: { width: 1, alignSelf: 'stretch' as const, backgroundColor: 'rgba(255,255,255,0.2)' },
  section: { marginHorizontal: 16, marginTop: 20 },
  sectionLabel: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase' as const, marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 14, borderWidth: 1, borderColor: themeColors.line },
  sectionTitle: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.text },
  sectionAmount: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.danger, marginRight: 4 },
  expandedContent: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 14, marginTop: 6, borderWidth: 1, borderColor: themeColors.line, gap: 8 },
  expenseListRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: themeColors.line },
  expenseListInfo: { flex: 1, gap: 2 },
  expenseListName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  expenseListMeta: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted },
  expenseListAmount: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text },
  expenseDeleteBtn: { padding: 6 },
  incomeListRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: themeColors.line },
  incomeListInfo: { flex: 1, gap: 2 },
  incomeListName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  incomeListMeta: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted },
  incomeListAmount: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.success },
  confidenceBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  confidenceBadgeText: { fontSize: 10, fontWeight: '700' as const },
  emptyListText: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted, textAlign: 'center', paddingVertical: 12 },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginTop: 4 },
  addItemText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  dangerCard: { backgroundColor: themeColors.danger, borderRadius: Tokens.radius.panel, padding: 16, borderWidth: 1, borderColor: themeColors.danger + '40', gap: 10, shadowColor: themeColors.danger, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 2 },
  dangerHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dangerTitle: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: themeColors.danger, letterSpacing: 0.2 },
  dangerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingLeft: 26, paddingVertical: 4, borderTopWidth: 1, borderTopColor: themeColors.danger + '15' },
  dangerDate: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, fontWeight: '500' as const },
  dangerBalance: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const, color: themeColors.danger, letterSpacing: -0.3 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryItem: { flex: 1, minWidth: '45%' as any, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 14, borderWidth: 1, borderColor: themeColors.line, gap: 6 },
  summaryIconWrap: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, marginBottom: -8 },
  summaryIcon: { width: 28, height: 28, borderRadius: Tokens.radius.sm, alignItems: 'center' as const, justifyContent: 'center' as const },
  summaryItemLabel: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, fontWeight: '600' as const, letterSpacing: 0.3, textTransform: 'uppercase' as const },
  summaryItemValue: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: themeColors.text, letterSpacing: -0.5 },
  summaryItemSub: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, fontWeight: '500' as const },
  weekDetailCard: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 14, borderWidth: 1, borderColor: themeColors.line },
  weekDetailRow: { flexDirection: 'row', gap: 8 },
  weekDetailItem: { flex: 1, alignItems: 'center', backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.md, padding: 10, gap: 4 },
  weekDetailLabel: { fontSize: Type.caption2.fontSize, fontWeight: '500' as const, color: themeColors.textMuted },
  weekDetailValue: { fontSize: Type.callout.fontSize, fontWeight: '800' as const },
  weekItemsGroup: { marginTop: 12, gap: 4 },
  weekItemsLabel: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textMuted, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  weekItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  weekItemName: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text, marginRight: 8 },
  weekItemAmount: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const },
  emptyWeekText: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted, textAlign: 'center', paddingVertical: 16 },
  aiButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: themeColors.accent, borderRadius: Tokens.radius.lg, paddingVertical: 14, shadowColor: themeColors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 3 },
  aiButtonText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  aiResultsCard: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.panel, padding: 16, marginTop: 12, borderWidth: 1, borderColor: themeColors.line, gap: 12 },
  aiResultsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiResultsTitle: { flex: 1, fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: themeColors.text },
  healthBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm },
  healthBadgeText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const },
  aiSummary: { fontSize: Type.bodyCompact.fontSize, color: themeColors.textSecondary, lineHeight: 20 },
  aiSection: { gap: 8, marginTop: 4 },
  aiSectionTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.text, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  criticalWeekRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  criticalWeekText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, lineHeight: 18 },
  recCard: { borderRadius: Tokens.radius.card, padding: 12, borderWidth: 1, gap: 6 },
  recHeader: { flexDirection: 'row', gap: 6 },
  recPriorityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  recPriorityText: { fontSize: 10, fontWeight: '700' as const, textTransform: 'uppercase' as const },
  recDiffBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  recDiffText: { fontSize: 10, fontWeight: '600' as const, color: themeColors.textMuted, textTransform: 'uppercase' as const },
  recAction: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text, lineHeight: 19 },
  recImpact: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bulletText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, lineHeight: 18 },
  aiGenLabel: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, textAlign: 'right', marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: themeColors.surface, borderRadius: 20, padding: 20, gap: 12 },
  modalCardBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, maxHeight: '80%', gap: 10 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: themeColors.text },
  modalFieldLabel: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 8 },
  modalInputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.card, paddingHorizontal: 12 },
  modalDollar: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: themeColors.accent },
  modalInput: { flex: 1, minHeight: 48, fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text, paddingHorizontal: 8 },
  modalTextInput: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: themeColors.text },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.md, backgroundColor: themeColors.line },
  chipActive: { backgroundColor: themeColors.accent },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  chipTextActive: { color: "#FFFFFF" },
  modalSaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: themeColors.accent, borderRadius: Tokens.radius.lg, paddingVertical: 14, marginTop: 12 },
  modalSaveBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
});
