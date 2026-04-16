import React, { useCallback, useState, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
  Platform, Modal, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, TrendingUp, FolderOpen, Layers, X, ChevronRight, Calculator, CalendarDays,
  BarChart3, TrendingDown, Package, DollarSign, Percent, ShoppingCart, ArrowDownRight,
  Receipt, Wallet,
} from 'lucide-react-native';
import { TouchableOpacity as TO } from 'react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import ProjectCard from '@/components/ProjectCard';
import AIWeeklySummary from '@/components/AIWeeklySummary';
import AICopilot from '@/components/AICopilot';
import AIHomeBriefing from '@/components/AIHomeBriefing';
import { useSubscription } from '@/contexts/SubscriptionContext';
import EmptyState from '@/components/EmptyState';
import CashFlowAlerts from '@/components/CashFlowAlerts';
import { generateForecast } from '@/utils/cashFlowEngine';
import type { CashFlowWeek } from '@/utils/cashFlowEngine';
import { loadCashFlowData, isSetupComplete } from '@/utils/cashFlowStorage';
import type { Project, ProjectType } from '@/types';
import { PROJECT_TYPES } from '@/types';
import { formatMoney, formatMoneyShort } from '@/utils/formatters';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, isLoading, addProject, getTotalOutstandingBalance, invoices } = useProjects();
  const { tier } = useSubscription();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('renovation');
  const [_createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [showNextStepModal, setShowNextStepModal] = useState(false);

  const totalOutstanding = getTotalOutstandingBalance();

  const [showTotalDetail, setShowTotalDetail] = useState(false);
  const [showSavingsDetail, setShowSavingsDetail] = useState(false);
  const [showWeeklySummary, setShowWeeklySummary] = useState(false);
  const [cashFlowForecast, setCashFlowForecast] = useState<CashFlowWeek[] | null>(null);

  useEffect(() => {
    const loadForecast = async () => {
      try {
        const setupDone = await isSetupComplete();
        if (!setupDone) return;
        const data = await loadCashFlowData();
        if (data.startingBalance > 0 || data.expenses.length > 0) {
          const forecast = generateForecast(
            data.startingBalance,
            data.expenses,
            [],
            data.expectedPayments,
            12,
            data.defaultPaymentTerms
          );
          setCashFlowForecast(forecast);
        }
      } catch (err) {
        console.log('[Home] Cash flow forecast load failed:', err);
      }
    };
    void loadForecast();
  }, [projects]);

  const totalEstimated = projects.reduce((sum, p) => {
    const linked = p.linkedEstimate;
    if (linked && (linked.items ?? []).length > 0) return sum + linked.grandTotal;
    return sum + (p.estimate?.grandTotal ?? 0);
  }, 0);
  const totalSavings = projects.reduce((sum, p) => {
    let savings = p.estimate?.bulkSavingsTotal ?? 0;
    if (p.linkedEstimate) {
      const linked = p.linkedEstimate;
      (linked.items ?? []).forEach(item => {
        if (item.usesBulk) {
          savings += (item.bulkPrice > 0 ? (item.unitPrice - item.bulkPrice) * item.quantity : 0);
        }
      });
    }
    return sum + savings;
  }, 0);

  const projectBreakdowns = useMemo(() => {
    return projects.map(p => {
      const linked = p.linkedEstimate;
      const legacy = p.estimate;
      let total = 0;
      let materialCost = 0;
      let laborCost = 0;
      let markupCost = 0;
      let bulkSavings = 0;
      let itemCount = 0;

      if (linked && (linked.items ?? []).length > 0) {
        total = linked.grandTotal;
        materialCost = linked.baseTotal;
        markupCost = linked.markupTotal;
        itemCount = (linked.items ?? []).length;
        (linked.items ?? []).forEach(item => {
          if (item.usesBulk) {
            bulkSavings += (item.unitPrice - item.bulkPrice) * item.quantity;
          }
        });
      } else if (legacy) {
        total = legacy.grandTotal;
        materialCost = legacy.materialTotal;
        laborCost = legacy.laborTotal;
        bulkSavings = legacy.bulkSavingsTotal;
        itemCount = (legacy.materials ?? []).length;
      }

      return {
        id: p.id,
        name: p.name,
        type: p.type,
        total,
        materialCost,
        laborCost,
        markupCost,
        bulkSavings,
        itemCount,
        hasLinked: !!(linked && (linked.items ?? []).length > 0),
        hasLegacy: !!legacy,
      };
    }).filter(b => b.total > 0);
  }, [projects]);

  const portfolioStats = useMemo(() => {
    const totalMaterials = projectBreakdowns.reduce((s, b) => s + b.materialCost, 0);
    const totalLabor = projectBreakdowns.reduce((s, b) => s + b.laborCost, 0);
    const totalMarkup = projectBreakdowns.reduce((s, b) => s + b.markupCost, 0);
    const totalBulk = projectBreakdowns.reduce((s, b) => s + b.bulkSavings, 0);
    const avgPerProject = projectBreakdowns.length > 0 ? totalEstimated / projectBreakdowns.length : 0;
    return { totalMaterials, totalLabor, totalMarkup, totalBulk, avgPerProject };
  }, [projectBreakdowns, totalEstimated]);

  const handleProjectPress = useCallback((project: Project) => {
    console.log('[Home] Opening project:', project.id);
    router.push({ pathname: '/project-detail' as any, params: { id: project.id } });
  }, [router]);

  const handleCreateProject = useCallback(() => {
    const name = projectName.trim();
    if (!name) {
      Alert.alert('Missing Name', 'Please enter a project name.');
      return;
    }
    const now = new Date().toISOString();
    const id = `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newProject: Project = {
      id,
      name,
      type: projectType,
      location: 'United States',
      squareFootage: 0,
      quality: 'standard',
      description: projectDescription.trim(),
      createdAt: now,
      updatedAt: now,
      estimate: null,
      schedule: null,
      status: 'draft',
    };
    addProject(newProject);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowCreateModal(false);
    setCreatedProjectId(id);
    setShowNextStepModal(true);
    setProjectName('');
    setProjectDescription('');
    setProjectType('renovation');
  }, [projectName, projectDescription, projectType, addProject]);

  const handleNextStep = useCallback((step: 'estimate' | 'schedule' | 'later') => {
    setShowNextStepModal(false);
    if (step === 'estimate') {
      router.push('/(tabs)/estimate' as any);
    } else if (step === 'schedule') {
      router.push('/(tabs)/schedule' as any);
    }
    setCreatedProjectId(null);
  }, [router]);

  const renderProject = useCallback(({ item }: { item: Project }) => (
    <ProjectCard project={item} onPress={() => handleProjectPress(item)} />
  ), [handleProjectPress]);

  const keyExtractor = useCallback((item: Project) => item.id, []);

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={Colors.primary} style={{ flex: 1 }} />
      </View>
    );
  }



  return (
    <View style={styles.container}>
      <FlatList
        data={projects}
        renderItem={renderProject}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top, paddingBottom: insets.bottom + 90 },
          projects.length === 0 && styles.emptyList,
        ]}
        ListHeaderComponent={
          <View>
            <View style={styles.navBar}>
              <Text style={styles.navTitle}>MAGE ID</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {projects.length > 0 && (
                  <TouchableOpacity
                    style={[styles.addButton, { backgroundColor: Colors.fillTertiary }]}
                    onPress={() => router.push('/cash-flow' as any)}
                    activeOpacity={0.7}
                    testID="cash-flow-btn"
                  >
                    <Wallet size={18} color={Colors.primary} strokeWidth={2} />
                  </TouchableOpacity>
                )}
                {projects.length > 0 && (
                  <TouchableOpacity
                    style={[styles.addButton, { backgroundColor: Colors.fillTertiary }]}
                    onPress={() => setShowWeeklySummary(true)}
                    activeOpacity={0.7}
                    testID="weekly-summary-btn"
                  >
                    <BarChart3 size={18} color={Colors.primary} strokeWidth={2} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => setShowCreateModal(true)}
                  activeOpacity={0.7}
                  testID="new-project-btn"
                >
                  <Plus size={18} color={Colors.surface} strokeWidth={2.5} />
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.largeTitle}>Projects</Text>

            {projects.length > 0 && (
              <View style={styles.statsSection}>
                <View style={styles.finCard}>
                  <View style={styles.finCardHeader}>
                    <View style={styles.finCardTitleRow}>
                      <View style={styles.finCardIconWrap}>
                        <BarChart3 size={16} color={Colors.primary} />
                      </View>
                      <Text style={styles.finCardTitle}>Financial Overview</Text>
                    </View>
                    <View style={styles.finCardBadge}>
                      <Layers size={11} color={Colors.primary} />
                      <Text style={styles.finCardBadgeText}>{projects.length} project{projects.length !== 1 ? 's' : ''}</Text>
                    </View>
                  </View>

                  <View style={styles.finMetricsRow}>
                    <TouchableOpacity
                      style={styles.finMetric}
                      onPress={() => {
                        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setShowTotalDetail(true);
                      }}
                      activeOpacity={0.7}
                      testID="total-value-tap"
                    >
                      <Text style={styles.finMetricLabel}>Total Value</Text>
                      <Text style={styles.finMetricValue}>{formatMoneyShort(totalEstimated)}</Text>
                      <View style={[styles.finMetricChip, { backgroundColor: Colors.info + '12' }]}>
                        <TrendingUp size={10} color={Colors.info} />
                        <Text style={[styles.finMetricChipText, { color: Colors.info }]}>Portfolio</Text>
                      </View>
                    </TouchableOpacity>

                    <View style={styles.finMetricDivider} />

                    <TouchableOpacity
                      style={styles.finMetric}
                      onPress={() => {
                        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setShowSavingsDetail(true);
                      }}
                      activeOpacity={0.7}
                      testID="bulk-savings-tap"
                    >
                      <Text style={styles.finMetricLabel}>Bulk Savings</Text>
                      <Text style={[styles.finMetricValue, { color: Colors.success }]}>{formatMoneyShort(totalSavings)}</Text>
                      <View style={[styles.finMetricChip, { backgroundColor: Colors.success + '12' }]}>
                        <TrendingDown size={10} color={Colors.success} />
                        <Text style={[styles.finMetricChipText, { color: Colors.success }]}>Saved</Text>
                      </View>
                    </TouchableOpacity>
                  </View>

                  {totalOutstanding > 0 && (
                    <View style={styles.finOutstandingRow}>
                      <View style={styles.finOutstandingLeft}>
                        <Receipt size={13} color={Colors.accent} />
                        <Text style={styles.finOutstandingLabel}>Outstanding</Text>
                      </View>
                      <View style={[styles.finMetricChip, { backgroundColor: Colors.accent + '12' }]}>
                        <Text style={[styles.finMetricChipText, { color: Colors.accent, fontWeight: '700' as const }]}>{formatMoneyShort(totalOutstanding)}</Text>
                      </View>
                    </View>
                  )}
                </View>
              </View>
            )}

            {projects.length > 0 && cashFlowForecast && cashFlowForecast.length > 0 && (
              <TouchableOpacity
                style={styles.cashFlowCard}
                onPress={() => router.push('/cash-flow' as any)}
                activeOpacity={0.7}
                testID="cash-flow-card"
              >
                <View style={styles.cashFlowHeader}>
                  <View style={[styles.cashFlowIconWrap]}>
                    <Wallet size={18} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cashFlowTitle}>Cash Flow Forecast</Text>
                    <Text style={styles.cashFlowSubtitle}>Next {cashFlowForecast.length} weeks</Text>
                  </View>
                  <ChevronRight size={18} color="rgba(255,255,255,0.6)" />
                </View>
                <View style={styles.cashFlowStats}>
                  <View style={styles.cashFlowStat}>
                    <Text style={styles.cashFlowStatLabel}>Balance</Text>
                    <Text style={styles.cashFlowStatValue}>
                      {formatMoneyShort(cashFlowForecast[0]?.runningBalance ?? 0)}
                    </Text>
                  </View>
                  <View style={[styles.cashFlowStat, { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.15)' }]}>
                    <Text style={styles.cashFlowStatLabel}>Income</Text>
                    <Text style={[styles.cashFlowStatValue, { color: '#86EFAC' }]}>
                      {formatMoneyShort(cashFlowForecast.reduce((s, w) => s + w.totalIncome, 0))}
                    </Text>
                  </View>
                  <View style={[styles.cashFlowStat, { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.15)' }]}>
                    <Text style={styles.cashFlowStatLabel}>Expenses</Text>
                    <Text style={[styles.cashFlowStatValue, { color: '#FCA5A5' }]}>
                      {formatMoneyShort(cashFlowForecast.reduce((s, w) => s + w.totalExpenses, 0))}
                    </Text>
                  </View>
                </View>
                {cashFlowForecast.some(w => w.runningBalance < 0) && (
                  <View style={styles.cashFlowWarning}>
                    <TrendingDown size={12} color="#FCD34D" />
                    <Text style={styles.cashFlowWarningText}>Negative balance projected — tap to review</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}

            {projects.length > 0 && (!cashFlowForecast || cashFlowForecast.length === 0) && (
              <TouchableOpacity
                style={[styles.cashFlowCard, { paddingVertical: 16 }]}
                onPress={() => router.push('/cash-flow' as any)}
                activeOpacity={0.7}
              >
                <View style={styles.cashFlowHeader}>
                  <View style={[styles.cashFlowIconWrap]}>
                    <Wallet size={18} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cashFlowTitle}>Set Up Cash Flow</Text>
                    <Text style={styles.cashFlowSubtitle}>Track income, expenses & forecast your finances</Text>
                  </View>
                  <ChevronRight size={18} color="rgba(255,255,255,0.6)" />
                </View>
              </TouchableOpacity>
            )}

            {projects.length > 0 && (
              <AIHomeBriefing
                projects={projects}
                invoices={invoices}
                subscriptionTier={tier as any}
                onViewFull={() => setShowWeeklySummary(true)}
              />
            )}

            {projects.length > 0 && (
              <CashFlowAlerts forecast={cashFlowForecast} invoices={[]} />
            )}

            {projects.length > 0 && (
              <Text style={styles.sectionHeader}>RECENT</Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={<FolderOpen size={36} color={Colors.textMuted} />}
            title="No Projects Yet"
            message="Create your first construction project to get started with estimates and scheduling."
            actionLabel="Create Project"
            onAction={() => setShowCreateModal(true)}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      <Modal visible={showCreateModal} transparent animationType="slide" onRequestClose={() => setShowCreateModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.createModalCard, { paddingBottom: insets.bottom + 20 }]}>
              <View style={styles.createModalHeader}>
                <Text style={styles.createModalTitle}>New Project</Text>
                <TouchableOpacity onPress={() => setShowCreateModal(false)} style={styles.closeBtn}>
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} style={styles.createModalScroll} keyboardShouldPersistTaps="handled">
                <Text style={styles.fieldLabel}>Project Name</Text>
                <TextInput
                  style={styles.input}
                  value={projectName}
                  onChangeText={setProjectName}
                  placeholder="e.g. Kitchen Renovation"
                  placeholderTextColor={Colors.textMuted}
                  autoFocus
                  testID="project-name-input"
                />

                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.input, styles.descInput]}
                  value={projectDescription}
                  onChangeText={setProjectDescription}
                  placeholder="Brief description of the project..."
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  textAlignVertical="top"
                  testID="project-desc-input"
                />

                <Text style={styles.fieldLabel}>Project Type</Text>
                <View style={styles.typeGrid}>
                  {PROJECT_TYPES.map(pt => (
                    <TouchableOpacity
                      key={pt.id}
                      style={[styles.typeChip, projectType === pt.id && styles.typeChipActive]}
                      onPress={() => setProjectType(pt.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.typeChipLabel, projectType === pt.id && styles.typeChipLabelActive]}>{pt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={{ height: 20 }} />
              </ScrollView>

              <TouchableOpacity style={styles.createBtn} onPress={handleCreateProject} activeOpacity={0.85} testID="create-project-btn">
                <Text style={styles.createBtnText}>Create Project</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={showTotalDetail}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        onRequestClose={() => setShowTotalDetail(false)}
      >
        <View style={[detailStyles.modalContainer, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }]}>
          <View style={detailStyles.modalHandle} />
          <View style={detailStyles.modalHeader}>
            <Text style={detailStyles.modalTitle}>Portfolio Value</Text>
            <TouchableOpacity
              style={detailStyles.modalCloseBtn}
              onPress={() => setShowTotalDetail(false)}
              activeOpacity={0.7}
              testID="close-total-detail"
            >
              <X size={20} color={Colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
            <View style={detailStyles.heroSection}>
              <View style={detailStyles.heroIconWrap}>
                <BarChart3 size={28} color={Colors.primary} />
              </View>
              <Text style={detailStyles.heroAmount}>${totalEstimated.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Text>
              <Text style={detailStyles.heroSubtitle}>Total Portfolio Value</Text>
              <View style={detailStyles.heroChips}>
                <View style={detailStyles.heroChip}>
                  <Text style={detailStyles.heroChipLabel}>{projectBreakdowns.length}</Text>
                  <Text style={detailStyles.heroChipSub}>with estimates</Text>
                </View>
                <View style={[detailStyles.heroChip, { backgroundColor: Colors.infoLight }]}>
                  <Text style={[detailStyles.heroChipLabel, { color: Colors.info }]}>
                    ${portfolioStats.avgPerProject.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </Text>
                  <Text style={[detailStyles.heroChipSub, { color: Colors.info }]}>avg / project</Text>
                </View>
              </View>
            </View>

            <Text style={detailStyles.sectionLabel}>Cost Composition</Text>
            <View style={detailStyles.barChartWrap}>
              {[
                { label: 'Materials', value: portfolioStats.totalMaterials, color: '#1A6B3C', icon: Package },
                { label: 'Labor', value: portfolioStats.totalLabor, color: '#007AFF', icon: DollarSign },
                { label: 'Markup', value: portfolioStats.totalMarkup, color: '#FF9500', icon: Percent },
              ].filter(r => r.value > 0).map(row => {
                const pct = totalEstimated > 0 ? (row.value / totalEstimated) * 100 : 0;
                return (
                  <View key={row.label} style={detailStyles.barRow}>
                    <View style={detailStyles.barLabelRow}>
                      <row.icon size={14} color={row.color} />
                      <Text style={detailStyles.barLabel}>{row.label}</Text>
                      <Text style={detailStyles.barPct}>{pct.toFixed(1)}%</Text>
                    </View>
                    <View style={detailStyles.barTrack}>
                      <View style={[detailStyles.barFill, { width: `${Math.min(pct, 100)}%`, backgroundColor: row.color }]} />
                    </View>
                    <Text style={detailStyles.barValue}>${row.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                  </View>
                );
              })}
              {totalSavings > 0 && (
                <View style={detailStyles.barRow}>
                  <View style={detailStyles.barLabelRow}>
                    <TrendingDown size={14} color={Colors.success} />
                    <Text style={[detailStyles.barLabel, { color: Colors.success }]}>Bulk Savings</Text>
                  </View>
                  <Text style={[detailStyles.barValue, { color: Colors.success }]}>-${totalSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                </View>
              )}
            </View>

            <Text style={detailStyles.sectionLabel}>By Project</Text>
            <View style={detailStyles.projectListCard}>
              {projectBreakdowns.map((b, idx) => (
                <View key={b.id}>
                  <View style={detailStyles.projectRow}>
                    <View style={detailStyles.projectRank}>
                      <Text style={detailStyles.projectRankText}>#{idx + 1}</Text>
                    </View>
                    <View style={detailStyles.projectInfo}>
                      <Text style={detailStyles.projectName} numberOfLines={1}>{b.name}</Text>
                      <Text style={detailStyles.projectMeta}>
                        {b.itemCount} items · {b.hasLinked ? 'Linked' : 'Estimated'}
                      </Text>
                    </View>
                    <View style={detailStyles.projectValues}>
                      <Text style={detailStyles.projectTotal}>${b.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                      <Text style={detailStyles.projectPct}>
                        {totalEstimated > 0 ? ((b.total / totalEstimated) * 100).toFixed(0) : 0}%
                      </Text>
                    </View>
                  </View>
                  {idx < projectBreakdowns.length - 1 && <View style={detailStyles.projectDivider} />}
                </View>
              ))}
              {projectBreakdowns.length === 0 && (
                <View style={detailStyles.emptyProject}>
                  <Text style={detailStyles.emptyProjectText}>No projects with estimates yet</Text>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={showSavingsDetail}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        onRequestClose={() => setShowSavingsDetail(false)}
      >
        <View style={[detailStyles.modalContainer, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }]}>
          <View style={detailStyles.modalHandle} />
          <View style={detailStyles.modalHeader}>
            <Text style={detailStyles.modalTitle}>Bulk Savings</Text>
            <TouchableOpacity
              style={detailStyles.modalCloseBtn}
              onPress={() => setShowSavingsDetail(false)}
              activeOpacity={0.7}
              testID="close-savings-detail"
            >
              <X size={20} color={Colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
            <View style={detailStyles.heroSection}>
              <View style={[detailStyles.heroIconWrap, { backgroundColor: Colors.successLight }]}>
                <TrendingDown size={28} color={Colors.success} />
              </View>
              <Text style={[detailStyles.heroAmount, { color: Colors.success }]}>
                ${totalSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </Text>
              <Text style={detailStyles.heroSubtitle}>Total Bulk Savings</Text>
              <View style={detailStyles.heroChips}>
                <View style={[detailStyles.heroChip, { backgroundColor: Colors.successLight }]}>
                  <Text style={[detailStyles.heroChipLabel, { color: Colors.success }]}>
                    {totalEstimated > 0 ? ((totalSavings / (totalEstimated + totalSavings)) * 100).toFixed(1) : '0'}%
                  </Text>
                  <Text style={[detailStyles.heroChipSub, { color: Colors.success }]}>savings rate</Text>
                </View>
                <View style={detailStyles.heroChip}>
                  <Text style={detailStyles.heroChipLabel}>
                    {projectBreakdowns.filter(b => b.bulkSavings > 0).length}
                  </Text>
                  <Text style={detailStyles.heroChipSub}>projects saving</Text>
                </View>
              </View>
            </View>

            <Text style={detailStyles.sectionLabel}>How Bulk Savings Work</Text>
            <View style={detailStyles.infoCard}>
              <View style={detailStyles.infoRow}>
                <View style={[detailStyles.infoStep, { backgroundColor: Colors.primary + '15' }]}>
                  <Text style={[detailStyles.infoStepNum, { color: Colors.primary }]}>1</Text>
                </View>
                <View style={detailStyles.infoTextWrap}>
                  <Text style={detailStyles.infoTitle}>Volume Thresholds</Text>
                  <Text style={detailStyles.infoDesc}>Each material has a min bulk quantity. Once met, a lower per-unit price is unlocked.</Text>
                </View>
              </View>
              <View style={detailStyles.infoRow}>
                <View style={[detailStyles.infoStep, { backgroundColor: Colors.success + '15' }]}>
                  <Text style={[detailStyles.infoStepNum, { color: Colors.success }]}>2</Text>
                </View>
                <View style={detailStyles.infoTextWrap}>
                  <Text style={detailStyles.infoTitle}>Automatic Application</Text>
                  <Text style={detailStyles.infoDesc}>When quantities exceed thresholds, savings are calculated automatically in your estimates.</Text>
                </View>
              </View>
              <View style={detailStyles.infoRow}>
                <View style={[detailStyles.infoStep, { backgroundColor: Colors.accent + '15' }]}>
                  <Text style={[detailStyles.infoStepNum, { color: Colors.accent }]}>3</Text>
                </View>
                <View style={detailStyles.infoTextWrap}>
                  <Text style={detailStyles.infoTitle}>Buy Direct</Text>
                  <Text style={detailStyles.infoDesc}>Visit the Marketplace tab to buy materials directly from suppliers at bulk rates.</Text>
                </View>
              </View>
            </View>

            <Text style={detailStyles.sectionLabel}>Savings by Project</Text>
            <View style={detailStyles.projectListCard}>
              {projectBreakdowns.filter(b => b.bulkSavings > 0).map((b, idx) => (
                <View key={b.id}>
                  <View style={detailStyles.projectRow}>
                    <View style={[detailStyles.projectRank, { backgroundColor: Colors.successLight }]}>
                      <Text style={[detailStyles.projectRankText, { color: Colors.success }]}>#{idx + 1}</Text>
                    </View>
                    <View style={detailStyles.projectInfo}>
                      <Text style={detailStyles.projectName} numberOfLines={1}>{b.name}</Text>
                      <Text style={detailStyles.projectMeta}>{b.itemCount} items</Text>
                    </View>
                    <View style={detailStyles.projectValues}>
                      <Text style={[detailStyles.projectTotal, { color: Colors.success }]}>
                        -${b.bulkSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </Text>
                    </View>
                  </View>
                  {idx < projectBreakdowns.filter(bd => bd.bulkSavings > 0).length - 1 && (
                    <View style={detailStyles.projectDivider} />
                  )}
                </View>
              ))}
              {projectBreakdowns.filter(b => b.bulkSavings > 0).length === 0 && (
                <View style={detailStyles.emptyProject}>
                  <Text style={detailStyles.emptyProjectText}>No bulk savings yet. Increase quantities to unlock bulk pricing.</Text>
                </View>
              )}
            </View>

            {projectBreakdowns.some(b => b.bulkSavings === 0 && b.total > 0) && (
              <>
                <Text style={detailStyles.sectionLabel}>Optimization Tips</Text>
                <View style={[detailStyles.infoCard, { backgroundColor: Colors.warningLight, borderColor: Colors.warning + '30' }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <ShoppingCart size={18} color={Colors.warning} />
                    <View style={{ flex: 1 }}>
                      <Text style={[detailStyles.infoTitle, { marginBottom: 4 }]}>Unlock More Savings</Text>
                      <Text style={detailStyles.infoDesc}>
                        {projectBreakdowns.filter(b => b.bulkSavings === 0 && b.total > 0).length} project(s) have no bulk savings yet. Increase material quantities past bulk thresholds to save more.
                      </Text>
                    </View>
                  </View>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showNextStepModal} transparent animationType="fade" onRequestClose={() => setShowNextStepModal(false)}>
        <Pressable style={styles.modalOverlayCenter} onPress={() => handleNextStep('later')}>
          <Pressable style={styles.nextStepCard} onPress={() => undefined}>
            <Text style={styles.nextStepTitle}>Project Created!</Text>
            <Text style={styles.nextStepDesc}>What would you like to do next?</Text>

            <TouchableOpacity style={styles.nextStepOption} onPress={() => handleNextStep('estimate')} activeOpacity={0.7}>
              <View style={[styles.nextStepIconWrap, { backgroundColor: Colors.primary + '15' }]}>
                <Calculator size={20} color={Colors.primary} />
              </View>
              <View style={styles.nextStepTextWrap}>
                <Text style={styles.nextStepOptionTitle}>Create Estimate</Text>
                <Text style={styles.nextStepOptionDesc}>Search materials and build a cost estimate</Text>
              </View>
              <ChevronRight size={18} color={Colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.nextStepOption} onPress={() => handleNextStep('schedule')} activeOpacity={0.7}>
              <View style={[styles.nextStepIconWrap, { backgroundColor: Colors.info + '15' }]}>
                <CalendarDays size={20} color={Colors.info} />
              </View>
              <View style={styles.nextStepTextWrap}>
                <Text style={styles.nextStepOptionTitle}>Create Schedule</Text>
                <Text style={styles.nextStepOptionDesc}>Plan tasks and timeline for this project</Text>
              </View>
              <ChevronRight size={18} color={Colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.laterBtn} onPress={() => handleNextStep('later')} activeOpacity={0.7}>
              <Text style={styles.laterBtnText}>I'll do this later</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <AIWeeklySummary
        projects={projects}
        visible={showWeeklySummary}
        onClose={() => setShowWeeklySummary(false)}
      />

      <AICopilot />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  listContent: {
    paddingBottom: 20,
  },
  emptyList: {
    flex: 1,
  },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  navTitle: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.5,
    paddingHorizontal: 20,
    marginTop: 4,
    marginBottom: 20,
  },
  statsSection: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  finCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  finCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  finCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  finCardIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  finCardTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.2,
  },
  finCardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary + '10',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  finCardBadgeText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  finMetricsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  finMetric: {
    flex: 1,
    gap: 4,
  },
  finMetricLabel: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.textMuted,
  },
  finMetricValue: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.8,
  },
  finMetricChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  finMetricChipText: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
  finMetricDivider: {
    width: 1,
    backgroundColor: Colors.borderLight,
    marginHorizontal: 14,
  },
  finOutstandingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  finOutstandingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  finOutstandingLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  cashFlowCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: '#0F172A',
    borderRadius: 18,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  cashFlowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cashFlowIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashFlowTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  cashFlowSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 1,
  },
  cashFlowStats: {
    flexDirection: 'row',
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    overflow: 'hidden' as const,
  },
  cashFlowStat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    gap: 2,
  },
  cashFlowStatLabel: {
    fontSize: 11,
    fontWeight: '500' as const,
    color: 'rgba(255,255,255,0.5)',
  },
  cashFlowStatValue: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: '#FFFFFF',
  },
  cashFlowWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    backgroundColor: 'rgba(251,191,36,0.12)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  cashFlowWarningText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#FCD34D',
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.6,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  modalOverlayCenter: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    padding: 24,
  },
  createModalCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    maxHeight: '85%',
  },
  createModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  createModalTitle: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createModalScroll: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 14,
    fontSize: 16,
    color: Colors.text,
  },
  descInput: {
    minHeight: 90,
    paddingTop: 14,
    textAlignVertical: 'top' as const,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.fillTertiary,
  },
  typeChipActive: {
    backgroundColor: Colors.primary,
  },
  typeChipLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  typeChipLabelActive: {
    color: Colors.textOnPrimary,
  },
  createBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 3,
  },
  createBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  nextStepCard: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 24,
    gap: 16,
  },
  nextStepTitle: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center',
  },
  nextStepDesc: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 4,
  },
  nextStepOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 16,
    padding: 16,
    gap: 14,
  },
  nextStepIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextStepTextWrap: {
    flex: 1,
    gap: 2,
  },
  nextStepOptionTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  nextStepOptionDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  laterBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  laterBtnText: {
    fontSize: 15,
    fontWeight: '500' as const,
    color: Colors.textMuted,
  },
});

const detailStyles = StyleSheet.create({
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHandle: { width: 36, height: 5, borderRadius: 3, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight, backgroundColor: Colors.background },
  modalTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.3 },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  heroSection: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20, gap: 6 },
  heroIconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.primary + '12', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  heroAmount: { fontSize: 38, fontWeight: '800' as const, color: Colors.text, letterSpacing: -1.5 },
  heroSubtitle: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500' as const },
  heroChips: { flexDirection: 'row', gap: 10, marginTop: 14 },
  heroChip: { backgroundColor: Colors.fillTertiary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center', gap: 2 },
  heroChipLabel: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  heroChipSub: { fontSize: 11, color: Colors.textMuted, fontWeight: '500' as const },
  sectionLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.8, paddingHorizontal: 20, marginBottom: 8, marginTop: 4 },
  barChartWrap: { marginHorizontal: 20, backgroundColor: Colors.surface, borderRadius: 16, padding: 16, gap: 16, marginBottom: 20, borderWidth: 1, borderColor: Colors.cardBorder },
  barRow: { gap: 6 },
  barLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barLabel: { flex: 1, fontSize: 14, fontWeight: '500' as const, color: Colors.text },
  barPct: { fontSize: 13, fontWeight: '700' as const, color: Colors.textSecondary },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: Colors.fillTertiary, overflow: 'hidden' as const },
  barFill: { height: 8, borderRadius: 4 },
  barValue: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  projectListCard: { marginHorizontal: 20, backgroundColor: Colors.surface, borderRadius: 16, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: Colors.cardBorder },
  projectRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  projectRank: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.infoLight, alignItems: 'center', justifyContent: 'center' },
  projectRankText: { fontSize: 11, fontWeight: '700' as const, color: Colors.info },
  projectInfo: { flex: 1, gap: 2 },
  projectName: { fontSize: 14, fontWeight: '500' as const, color: Colors.text },
  projectMeta: { fontSize: 12, color: Colors.textMuted },
  projectValues: { alignItems: 'flex-end', gap: 1 },
  projectTotal: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  projectPct: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary, backgroundColor: Colors.fillTertiary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' as const },
  projectDivider: { height: 1, backgroundColor: Colors.borderLight },
  emptyProject: { alignItems: 'center', paddingVertical: 20 },
  emptyProjectText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' as const },
  infoCard: { marginHorizontal: 20, backgroundColor: Colors.surface, borderRadius: 16, padding: 16, gap: 16, marginBottom: 20, borderWidth: 1, borderColor: Colors.cardBorder },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  infoStep: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  infoStepNum: { fontSize: 13, fontWeight: '700' as const },
  infoTextWrap: { flex: 1 },
  infoTitle: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  infoDesc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginTop: 2 },
});

