import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Platform,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, FileText, Download, Info, Percent, Printer, TrendingUp, Check, Save,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import ConstructionLoader from '@/components/ConstructionLoader';
import { useProjects } from '@/contexts/ProjectContext';
import { formatMoney } from '@/utils/formatters';
import {
  AIAPayApplication,
  AIASOVLine,
  seedAIAPayApplicationFromInvoice,
  computeAIATotals,
  generateAIAPayAppPDF,
} from '@/utils/aiaBilling';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { generateUUID } from '@/utils/generateId';
import type { SavedAIAPayApp } from '@/types';

export default function AIAPayAppScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('aia_pay_app')) {
    return (
      <Paywall
        visible={true}
        feature="AIA G702/G703 Pay Applications"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <AIAPayAppScreenInner />;
}

function AIAPayAppScreenInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const {
    invoices, getProject, getChangeOrdersForProject, settings,
    addAIAPayApp, getAIAPayAppsForProject,
  } = useProjects();

  const invoice = useMemo(() => invoices.find(i => i.id === invoiceId), [invoices, invoiceId]);
  const project = useMemo(() => (invoice ? getProject(invoice.projectId) : undefined), [invoice, getProject]);
  const approvedCOs = useMemo(() =>
    (invoice && project ? getChangeOrdersForProject(project.id).filter(co => co.status === 'approved') : []),
    [invoice, project, getChangeOrdersForProject]);

  const [app, setApp] = useState<AIAPayApplication | null>(null);
  const [generating, setGenerating] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!invoice || !project || !settings?.branding) return;
    const seeded = seedAIAPayApplicationFromInvoice(invoice, project, approvedCOs, settings.branding);
    setApp(seeded);
  }, [invoice, project, approvedCOs, settings?.branding]);

  const totals = useMemo(() => (app ? computeAIATotals(app) : null), [app]);

  const updateLine = useCallback((lineId: string, patch: Partial<AIASOVLine>) => {
    setApp(prev => prev ? {
      ...prev,
      lines: prev.lines.map(l => l.id === lineId ? { ...l, ...patch } : l),
    } : prev);
  }, []);

  const applyPercentToLine = useCallback((lineId: string, percent: number) => {
    setApp(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        lines: prev.lines.map(l => {
          if (l.id !== lineId) return l;
          const totalCompleted = Math.max(0, Math.min(l.scheduledValue, l.scheduledValue * (percent / 100)));
          const thisPeriod = Math.max(0, totalCompleted - l.fromPreviousApp);
          return { ...l, thisPeriod };
        }),
      };
    });
  }, []);

  const updateRetainagePctAll = useCallback((pct: number) => {
    setApp(prev => prev ? {
      ...prev,
      retainagePercent: pct,
      lines: prev.lines.map(l => ({ ...l, retainagePercent: pct })),
    } : prev);
  }, []);

  // Build a portable SavedAIAPayApp record from the in-memory app + computed
  // totals. Used both for the explicit "Save to Project" tap and as a
  // side-effect of generating the PDF (so the portal always has the latest
  // billing once the GC has gone through the trouble of producing it).
  const buildSavedRecord = useCallback((): SavedAIAPayApp | null => {
    if (!app || !project || !totals) return null;
    const existing = getAIAPayAppsForProject(project.id).find(a => a.applicationNumber === app.applicationNumber);
    return {
      id: existing?.id ?? generateUUID(),
      projectId: project.id,
      invoiceId: invoice?.id,
      applicationNumber: app.applicationNumber,
      applicationDate: app.applicationDate,
      periodTo: app.periodTo,
      contractDate: app.contractDate,
      ownerName: app.ownerName,
      contractorName: app.contractorName,
      architectName: app.architectName,
      projectName: app.projectName,
      projectLocation: app.projectLocation,
      contractForDescription: app.contractForDescription,
      originalContractSum: app.originalContractSum,
      netChangeByCO: app.netChangeByCO,
      contractSumToDate: app.contractSumToDate,
      retainagePercent: app.retainagePercent,
      lessPreviousCertificates: app.lessPreviousCertificates,
      lines: app.lines.map(l => ({
        id: l.id,
        itemNo: l.itemNo,
        description: l.description,
        scheduledValue: l.scheduledValue,
        fromPreviousApp: l.fromPreviousApp,
        thisPeriod: l.thisPeriod,
        materialsPresentlyStored: l.materialsPresentlyStored,
        retainagePercent: l.retainagePercent,
      })),
      notes: app.notes,
      totals: {
        totalScheduledValue: totals.totalScheduledValue,
        totalCompletedAndStored: totals.totalCompletedAndStored,
        totalRetainage: totals.totalRetainage,
        totalEarnedLessRetainage: totals.totalEarnedLessRetainage,
        currentPaymentDue: totals.currentPaymentDue,
        balanceToFinish: totals.balanceToFinish,
        percentComplete: totals.percentComplete,
      },
      savedAt: new Date().toISOString(),
    };
  }, [app, project, totals, invoice?.id, getAIAPayAppsForProject]);

  const handleSave = useCallback(() => {
    const rec = buildSavedRecord();
    if (!rec) return;
    addAIAPayApp(rec);
    setSavedFlash(true);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setSavedFlash(false), 2200);
  }, [buildSavedRecord, addAIAPayApp]);

  const handleGenerate = useCallback(async () => {
    if (!app || !settings?.branding) return;
    setGenerating(true);
    try {
      await generateAIAPayAppPDF(app, settings.branding);
      // Persist the same record so the client portal can show this billing
      // alongside the printed PDF the GC just shared.
      const rec = buildSavedRecord();
      if (rec) addAIAPayApp(rec);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Error', 'Could not generate the pay application PDF.');
    } finally {
      setGenerating(false);
    }
  }, [app, settings?.branding, buildSavedRecord, addAIAPayApp]);

  if (!invoice || !project) {
    return (
      <View style={styles.loadingContainer}>
        <Stack.Screen options={{ title: 'Pay Application' }} />
        <Info size={32} color={Colors.textMuted} />
        <Text style={styles.loadingText}>Invoice not found.</Text>
      </View>
    );
  }

  if (!app || !totals) {
    return (
      <View style={styles.loadingContainer}>
        <Stack.Screen options={{ title: 'Pay Application' }} />
        <ConstructionLoader size="lg" />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'AIA Pay Application',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }}>
              <ChevronLeft size={24} color={Colors.primary} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero summary card */}
        <View style={styles.hero}>
          <View style={styles.heroHeaderRow}>
            <View style={styles.heroTitleBlock}>
              <Text style={styles.heroLabel}>G702 · G703</Text>
              <Text style={styles.heroTitle}>Pay Application #{app.applicationNumber}</Text>
              <Text style={styles.heroSub}>{project.name}</Text>
            </View>
            <View style={styles.progressBadge}>
              <Text style={styles.progressBadgeNum}>{totals.percentComplete.toFixed(0)}%</Text>
              <Text style={styles.progressBadgeLabel}>Complete</Text>
            </View>
          </View>

          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Contract Sum</Text>
              <Text style={styles.heroStatValue}>{formatMoney(app.contractSumToDate)}</Text>
              {app.netChangeByCO !== 0 && (
                <Text style={styles.heroStatSub}>
                  incl. {app.netChangeByCO >= 0 ? '+' : '-'}{formatMoney(Math.abs(app.netChangeByCO))} COs
                </Text>
              )}
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>This Period Due</Text>
              <Text style={[styles.heroStatValue, { color: Colors.primary }]}>
                {formatMoney(totals.currentPaymentDue)}
              </Text>
              <Text style={styles.heroStatSub}>after retainage</Text>
            </View>
          </View>
        </View>

        {/* Header meta */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Application Details</Text>
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Owner Name</Text>
            <TextInput
              style={styles.formInput}
              value={app.ownerName}
              onChangeText={v => setApp(p => p ? { ...p, ownerName: v } : p)}
              placeholder="Owner / Client name"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Architect</Text>
            <TextInput
              style={styles.formInput}
              value={app.architectName ?? ''}
              onChangeText={v => setApp(p => p ? { ...p, architectName: v } : p)}
              placeholder="Optional"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Less Previous Certificates</Text>
            <TextInput
              style={styles.formInput}
              value={String(app.lessPreviousCertificates)}
              onChangeText={v => {
                const n = parseFloat(v.replace(/[^0-9.-]/g, ''));
                setApp(p => p ? { ...p, lessPreviousCertificates: isNaN(n) ? 0 : n } : p);
              }}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Retainage %</Text>
            <View style={styles.retainageChips}>
              {[0, 5, 10].map(pct => (
                <TouchableOpacity
                  key={pct}
                  onPress={() => updateRetainagePctAll(pct)}
                  style={[styles.chip, app.retainagePercent === pct && styles.chipActive]}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, app.retainagePercent === pct && styles.chipTextActive]}>
                    {pct}%
                  </Text>
                </TouchableOpacity>
              ))}
              <TextInput
                style={[styles.formInput, { width: 70, textAlign: 'center' }]}
                value={String(app.retainagePercent)}
                onChangeText={v => {
                  const n = parseFloat(v.replace(/[^0-9.]/g, ''));
                  updateRetainagePctAll(isNaN(n) ? 0 : Math.max(0, Math.min(50, n)));
                }}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
        </View>

        {/* Schedule of Values */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Schedule of Values (G703)</Text>
            <Text style={styles.sectionTitleCount}>{app.lines.length} items</Text>
          </View>
          <Text style={styles.sectionHint}>
            Tap a line to adjust this period's work completed. Use the % slider to quickly set line progress.
          </Text>

          {app.lines.map(line => {
            const totalCompleted = line.fromPreviousApp + line.thisPeriod + line.materialsPresentlyStored;
            const pct = line.scheduledValue > 0 ? (totalCompleted / line.scheduledValue) * 100 : 0;
            return (
              <View key={line.id} style={styles.sovCard}>
                <View style={styles.sovHeaderRow}>
                  <View style={styles.sovItemNoPill}>
                    <Text style={styles.sovItemNoText}>#{line.itemNo}</Text>
                  </View>
                  <Text style={styles.sovDescription} numberOfLines={2}>{line.description}</Text>
                </View>

                <View style={styles.sovValueRow}>
                  <View style={styles.sovValueCol}>
                    <Text style={styles.sovValueLabel}>Scheduled</Text>
                    <Text style={styles.sovValueNum}>{formatMoney(line.scheduledValue)}</Text>
                  </View>
                  <View style={styles.sovValueCol}>
                    <Text style={styles.sovValueLabel}>This Period</Text>
                    <TextInput
                      style={styles.sovInput}
                      value={line.thisPeriod.toFixed(2)}
                      onChangeText={v => {
                        const n = parseFloat(v.replace(/[^0-9.-]/g, ''));
                        updateLine(line.id, { thisPeriod: isNaN(n) ? 0 : n });
                      }}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                    />
                  </View>
                  <View style={styles.sovValueCol}>
                    <Text style={styles.sovValueLabel}>Stored</Text>
                    <TextInput
                      style={styles.sovInput}
                      value={line.materialsPresentlyStored.toFixed(2)}
                      onChangeText={v => {
                        const n = parseFloat(v.replace(/[^0-9.-]/g, ''));
                        updateLine(line.id, { materialsPresentlyStored: isNaN(n) ? 0 : n });
                      }}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                    />
                  </View>
                </View>

                <View style={styles.sovProgressRow}>
                  <View style={styles.sovProgressBar}>
                    <View style={[styles.sovProgressFill, { width: `${Math.min(100, pct)}%` as any }]} />
                  </View>
                  <Text style={styles.sovProgressPct}>{pct.toFixed(0)}%</Text>
                </View>

                <View style={styles.sovQuickRow}>
                  {[25, 50, 75, 100].map(q => (
                    <TouchableOpacity
                      key={q}
                      onPress={() => applyPercentToLine(line.id, q)}
                      style={styles.sovQuickBtn}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.sovQuickText}>{q}%</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            );
          })}
        </View>

        {/* Running totals */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Summary (G702 Cover)</Text>
          <View style={styles.totalsCard}>
            <Row label="Original Contract Sum" value={formatMoney(app.originalContractSum)} />
            <Row label="Net Change by COs" value={`${app.netChangeByCO >= 0 ? '+' : '-'}${formatMoney(Math.abs(app.netChangeByCO))}`} />
            <Row label="Contract Sum to Date" value={formatMoney(app.contractSumToDate)} bold />
            <Divider />
            <Row label="Total Completed & Stored" value={formatMoney(totals.totalCompletedAndStored)} />
            <Row label={`Retainage (${app.retainagePercent}%)`} value={`-${formatMoney(totals.totalRetainage)}`} dim />
            <Row label="Total Earned Less Retainage" value={formatMoney(totals.totalEarnedLessRetainage)} />
            <Row label="Less Previous Certificates" value={`-${formatMoney(app.lessPreviousCertificates)}`} dim />
            <Divider />
            <Row label="Current Payment Due" value={formatMoney(totals.currentPaymentDue)} highlight />
            <Row label="Balance to Finish" value={formatMoney(totals.balanceToFinish)} dim />
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.bottomBarRow}>
          <TouchableOpacity
            style={[styles.saveBtn, savedFlash && styles.saveBtnDone]}
            onPress={handleSave}
            activeOpacity={0.85}
          >
            {savedFlash
              ? <Check size={18} color={Colors.primary} />
              : <Save size={18} color={Colors.primary} />
            }
            <Text style={styles.saveBtnText}>
              {savedFlash ? 'Saved to project' : 'Save to project'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.generateBtn, { flex: 1 }]}
            onPress={handleGenerate}
            disabled={generating}
            activeOpacity={0.85}
          >
            {generating
              ? <ActivityIndicator size="small" color="#FFF" />
              : <Printer size={18} color="#FFF" />
            }
            <Text style={styles.generateBtnText}>
              {generating ? 'Generating…' : 'Generate PDF'}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.bottomBarHint}>
          Saved pay applications appear in your client portal so owners and architects can review and download.
        </Text>
      </View>
    </>
  );
}

function Row({ label, value, bold, dim, highlight }: { label: string; value: string; bold?: boolean; dim?: boolean; highlight?: boolean }) {
  return (
    <View style={styles.totalsRow}>
      <Text style={[styles.totalsLabel, dim && { color: Colors.textMuted }]}>{label}</Text>
      <Text style={[
        styles.totalsValue,
        bold && { fontWeight: '700' },
        dim && { color: Colors.textMuted },
        highlight && { color: Colors.primary, fontSize: 17, fontWeight: '800' },
      ]}>
        {value}
      </Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.totalsDivider} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: Colors.background },
  loadingText: { fontSize: 14, color: Colors.textMuted },

  hero: {
    margin: 16, padding: 16, borderRadius: 16,
    backgroundColor: Colors.primary + '10',
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heroTitleBlock: { flex: 1 },
  heroLabel: { fontSize: 10, color: Colors.primary, fontWeight: '700', letterSpacing: 1.5, marginBottom: 4 },
  heroTitle: { fontSize: 20, fontWeight: '800', color: Colors.text, marginBottom: 2 },
  heroSub: { fontSize: 13, color: Colors.textMuted },
  progressBadge: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: 50,
    width: 68, height: 68,
  },
  progressBadgeNum: { fontSize: 18, fontWeight: '800', color: '#FFF', lineHeight: 20 },
  progressBadgeLabel: { fontSize: 9, color: '#FFFFFFCC', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  heroStats: { flexDirection: 'row', gap: 12, marginTop: 14 },
  heroStat: { flex: 1, backgroundColor: Colors.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.border },
  heroStatLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600', marginBottom: 4 },
  heroStatValue: { fontSize: 18, fontWeight: '800', color: Colors.text },
  heroStatSub: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },

  section: { marginHorizontal: 16, marginBottom: 20 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  sectionTitleCount: { fontSize: 12, color: Colors.textMuted },
  sectionHint: { fontSize: 12, color: Colors.textMuted, marginBottom: 10, lineHeight: 16 },

  formRow: { marginBottom: 10 },
  formLabel: { fontSize: 12, color: Colors.textMuted, marginBottom: 4, fontWeight: '600' },
  formInput: {
    backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: Colors.text,
  },

  retainageChips: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.text },
  chipTextActive: { color: '#FFF' },

  sovCard: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 12,
    marginBottom: 10, borderWidth: 1, borderColor: Colors.border,
  },
  sovHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  sovItemNoPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
    backgroundColor: Colors.primary + '15',
  },
  sovItemNoText: { fontSize: 11, fontWeight: '700', color: Colors.primary },
  sovDescription: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.text, lineHeight: 18 },

  sovValueRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  sovValueCol: { flex: 1 },
  sovValueLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '600', marginBottom: 4 },
  sovValueNum: { fontSize: 14, fontWeight: '700', color: Colors.text },
  sovInput: {
    backgroundColor: Colors.background, borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 8, paddingVertical: 8, fontSize: 13, color: Colors.text,
  },

  sovProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sovProgressBar: { flex: 1, height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  sovProgressFill: { height: '100%', backgroundColor: '#34C759', borderRadius: 3 },
  sovProgressPct: { fontSize: 11, fontWeight: '700', color: Colors.text, width: 38, textAlign: 'right' },

  sovQuickRow: { flexDirection: 'row', gap: 6 },
  sovQuickBtn: {
    flex: 1, paddingVertical: 6, borderRadius: 6,
    backgroundColor: Colors.background, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  sovQuickText: { fontSize: 11, fontWeight: '600', color: Colors.text },

  totalsCard: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  totalsLabel: { fontSize: 13, color: Colors.text },
  totalsValue: { fontSize: 14, fontWeight: '600', color: Colors.text },
  totalsDivider: { height: 1, backgroundColor: Colors.border, marginVertical: 6 },

  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.background,
    borderTopWidth: 1, borderTopColor: Colors.border,
    paddingHorizontal: 16, paddingTop: 12,
  },
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: Colors.primary, borderRadius: 12,
    paddingVertical: 14,
  },
  generateBtnText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  bottomBarRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  saveBtnDone: { backgroundColor: Colors.primary + '20', borderColor: Colors.primary },
  saveBtnText: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  bottomBarHint: {
    fontSize: 11, color: Colors.textMuted, textAlign: 'center',
    marginTop: 8, lineHeight: 15,
  },
});
