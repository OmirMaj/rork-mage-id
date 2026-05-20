import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Platform,
  ActivityIndicator, Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Info, Printer, Check, Save,
  ShieldAlert, CheckCircle2, FileText,
} from 'lucide-react-native';
import EmptyState from '@/components/EmptyState';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import ConstructionLoader from '@/components/ConstructionLoader';
import { FeatureHeader } from '@/components/FeatureHeader';
import { useProjects } from '@/contexts/ProjectContext';
import { formatMoney } from '@/utils/formatters';
import { legacyEvmMetrics } from '@/utils/scheduleEarnedValue';
import {
  AIAPayApplication,
  AIASOVLine,
  seedAIAPayApplicationFromInvoice,
  computeAIATotals,
  generateAIAPayAppPDF,
} from '@/utils/aiaBilling';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { RevenueEarlyAccessCard } from '@/components/RevenueEarlyAccessCard';
import { Banknote, FileSignature } from 'lucide-react-native';
import Paywall from '@/components/Paywall';
import { generateUUID } from '@/utils/generateId';
import { useAuth } from '@/contexts/AuthContext';
import { createPaymentLink } from '@/utils/stripe';
import { fetchStripeConnectStatus } from '@/utils/stripeConnect';
import type { SavedAIAPayApp } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function AIAPayAppScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const { tier } = useSubscription();
  const { colors: themeColors } = useTheme();
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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { tier } = useSubscription();
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const {
    invoices, getProject, getChangeOrdersForProject, settings,
    addAIAPayApp, getAIAPayAppsForProject,
  } = useProjects();

  const { user } = useAuth();
  const invoice = useMemo(() => invoices.find(i => i.id === invoiceId), [invoices, invoiceId]);
  const project = useMemo(() => (invoice ? getProject(invoice.projectId) : undefined), [invoice, getProject]);
  const approvedCOs = useMemo(() =>
    (invoice && project ? getChangeOrdersForProject(project.id).filter(co => co.status === 'approved') : []),
    [invoice, project, getChangeOrdersForProject]);

  const [app, setApp] = useState<AIAPayApplication | null>(null);
  const [generating, setGenerating] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [showFirstUseDisclaimer, setShowFirstUseDisclaimer] = useState(false);
  const [showPreExportConfirm, setShowPreExportConfirm] = useState(false);

  // First-time user notice — explains AIA trademark + GC responsibility.
  // Once dismissed, never shown again on this device. Stored in AsyncStorage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const seen = await AsyncStorage.getItem('mage_aia_disclaimer_v1');
        if (!cancelled && !seen) setShowFirstUseDisclaimer(true);
      } catch { /* ok */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const dismissFirstUseDisclaimer = useCallback(async () => {
    setShowFirstUseDisclaimer(false);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      await AsyncStorage.setItem('mage_aia_disclaimer_v1', new Date().toISOString());
    } catch { /* ok */ }
  }, []);

  // Most recent saved pay app for this project that is NOT this one. Drives
  // the carry-forward affordance — every monthly AIA pay app should
  // pre-populate `fromPreviousApp` and `lessPreviousCertificates` from the
  // prior period's totals, otherwise the GC has to re-type every line's
  // billed-to-date amount each month. That's the single biggest friction
  // point GCs cite about pay-app software (Procore, Sage, Foundation
  // reviews all complain about it).
  const priorAIA = useMemo(() => {
    if (!project || !invoice) return null;
    const all = getAIAPayAppsForProject(project.id);
    // Pick the highest applicationNumber that's strictly less than the one
    // we're about to seed (which equals the count of prior apps + 1).
    const others = all.filter(a => a.invoiceId !== invoice.id);
    return [...others].sort((a, b) => b.applicationNumber - a.applicationNumber)[0] ?? null;
  }, [project, invoice, getAIAPayAppsForProject]);

  const [carriedFromAppNumber, setCarriedFromAppNumber] = useState<number | null>(null);

  useEffect(() => {
    if (!invoice || !project || !settings?.branding) return;
    const seeded = seedAIAPayApplicationFromInvoice(invoice, project, approvedCOs, settings.branding);
    // Carry-forward: when there's a prior saved pay app, pre-fill each line's
    // fromPreviousApp with what was billed through the end of the prior
    // period (prior.fromPreviousApp + prior.thisPeriod), and pre-fill the
    // G702 "less previous certificates" with the prior period's earned
    // amount net of retainage. Match lines by itemNo ONLY — pre-fix this
    // also fell back to description, but two SOV lines sharing a description
    // (e.g. "Concrete — slab on grade" repeated for two phases) would have
    // the second line silently inherit the first line's billed-through, off-
    // by-one'ing the entire pay app. AIA G702/G703 keys on itemNo for a
    // reason; if the GC reorders lines they need to keep the numbering
    // stable. Lines without a prior match get fromPreviousApp = 0 and the
    // GC enters this-period-only.
    if (priorAIA && priorAIA.lines.length > 0) {
      const priorByItem = new Map(priorAIA.lines.map(l => [l.itemNo, l]));
      const carriedLines = seeded.lines.map(line => {
        const match = priorByItem.get(line.itemNo);
        if (!match) return line;
        const billedThrough = (match.fromPreviousApp || 0) + (match.thisPeriod || 0);
        return { ...line, fromPreviousApp: billedThrough };
      });
      const carried = {
        ...seeded,
        applicationNumber: priorAIA.applicationNumber + 1,
        lines: carriedLines,
        lessPreviousCertificates: priorAIA.totals.totalEarnedLessRetainage || 0,
      };
      setApp(carried);
      setCarriedFromAppNumber(priorAIA.applicationNumber);
    } else {
      setApp(seeded);
      setCarriedFromAppNumber(null);
    }
  }, [invoice, project, approvedCOs, settings?.branding, priorAIA]);

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

  // v2.3 wedge A2 — apply the project-level cost-weighted EV % to every
  // AIA line. Per-line linkedTaskId mapping (a SavedAIAPayAppLine field)
  // is its own sub-project — this is project-level sync only.
  const handleSyncFromSchedule = useCallback(() => {
    if (!project?.schedule || !project.linkedEstimate || !app) {
      Alert.alert(
        'No schedule data',
        'Link a schedule with a linked estimate to use this action.'
      );
      return;
    }
    const metrics = legacyEvmMetrics(project, [], project.schedule);
    const pct = Math.round(metrics.percentComplete);
    if (pct <= 0) {
      Alert.alert(
        'No progress yet',
        'Schedule shows 0% complete. Update task progress first.'
      );
      return;
    }
    app.lines.forEach(line => applyPercentToLine(line.id, pct));
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [project, app, applyPercentToLine]);

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

  const handleSave = useCallback(async () => {
    const rec = buildSavedRecord();
    if (!rec) return;

    // Auto-attach a Stripe pay link for `currentPaymentDue` if the GC has
    // Connect onboarded. Mirrors the invoice flow at app/invoice.tsx:350-385.
    // Pre-audit (May 2026), AIA pay apps generated PDFs but had no payment
    // wiring at all — homeowners got a print-only document while regular
    // invoices had Pay buttons. We close the asymmetry here.
    let payLinkUrl = rec.payLinkUrl;
    let payLinkId = rec.payLinkId;
    let stripeNotConnected = false;
    let stripeFailureReason: string | null = null;
    const due = rec.totals?.currentPaymentDue ?? 0;
    if (!payLinkUrl && due > 0 && user?.id) {
      try {
        const status = await fetchStripeConnectStatus(user.id);
        if (status.success && status.chargesEnabled && status.accountId) {
          const res = await createPaymentLink({
            invoiceId: rec.id,
            invoiceNumber: rec.applicationNumber,
            projectName: rec.projectName ?? 'Project',
            amountCents: Math.round(due * 100),
            // No customer email at this point — the homeowner email is
            // captured at portal-link share time, not here. Stripe will
            // collect at checkout.
            customerEmail: '',
            companyName: rec.contractorName ?? settings?.branding?.companyName ?? 'Contractor',
            stripeAccountId: status.accountId,
            userTier: tier,
          });
          if (res.success && res.url && res.id) {
            payLinkUrl = res.url;
            payLinkId = res.id;
          } else {
            console.warn('[AIA] Auto-generate payment link failed:', res.error);
            stripeFailureReason = res.error ?? 'unknown';
          }
        } else {
          console.log('[AIA] Skipping payment link — Stripe Connect not set up for this user');
          stripeNotConnected = true;
        }
      } catch (err) {
        console.warn('[AIA] Auto-generate payment link threw:', err);
        stripeFailureReason = (err as Error)?.message ?? 'network error';
      }
    }

    addAIAPayApp({ ...rec, payLinkUrl, payLinkId });
    setSavedFlash(true);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setSavedFlash(false), 2200);

    // Surface the Stripe outcome AFTER save so the GC isn't surprised by
    // a print-only AIA on the homeowner portal. Pre-audit this was a
    // silent console.warn — the GC believed the pay app shipped with a
    // Pay button and homeowners just saw a static PDF. Now they get a
    // real choice: set up Stripe, or accept that AIA goes out without
    // one-tap pay.
    if (stripeNotConnected && due > 0) {
      Alert.alert(
        'Saved — but no Pay button',
        'You haven\'t connected Stripe yet, so this AIA pay application was saved without a one-tap Pay button on the client portal. Set up Stripe to add Pay buttons to AIA apps and invoices going forward.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Set up Stripe', onPress: () => router.push('/payments-setup' as never) },
        ],
      );
    } else if (stripeFailureReason && due > 0) {
      Alert.alert(
        'Saved — Pay button could not be attached',
        `Stripe didn't reach us when generating the payment link (${stripeFailureReason}). The AIA is saved; you can re-share later when Stripe is reachable to attach a Pay button.`,
        [{ text: 'OK', style: 'default' }],
      );
    }
  }, [buildSavedRecord, addAIAPayApp, user, settings, router]);

  // Tap "Generate PDF" → show pre-export confirmation first (liability
  // reducer). Once user confirms they reviewed the totals, we actually
  // generate.
  const requestGenerate = useCallback(() => {
    if (!app || !settings?.branding) return;
    setShowPreExportConfirm(true);
  }, [app, settings?.branding]);

  const handleGenerate = useCallback(async () => {
    setShowPreExportConfirm(false);
    if (!app || !settings?.branding) return;
    setGenerating(true);
    try {
      await generateAIAPayAppPDF(app, settings.branding);
      // Persist + attach pay link via the same code path as handleSave so
      // the portal-side rendering of this AIA app gets a Pay button.
      await handleSave();
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Error', 'Could not generate the pay application PDF.');
    } finally {
      setGenerating(false);
    }
  }, [app, settings?.branding, handleSave]);

  if (!invoice || !project) {
    return (
      <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
        <Stack.Screen options={{ title: 'AIA Pay Apps' }} />
        <EmptyState
          icon={<FileText size={36} color={themeColors.accent} strokeWidth={1.6} />}
          title="No AIA pay app open yet"
          message="AIA pay applications (G702 / G703) bill against an existing progress invoice. To start one:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Inside that project, create a Progress Invoice from your estimate or schedule of values.',
            'On the invoice, tap Generate AIA Pay App to fill G702/G703 and route for sign-off.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
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
          title: 'Progress Billing',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }} accessibilityRole="button" accessibilityLabel="Back">
              <ChevronLeft size={24} color={themeColors.accent} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.bg }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        keyboardShouldPersistTaps="handled"
      >
        <FeatureHeader
          eyebrow="AIA G702 / G703"
          title="Bill the bank"
          subtitle="Turn your % complete into the AIA pay application your owner&apos;s lender expects. Auto-fills contract sum, retainage, and the schedule of values."
          explainer={{
            term: 'AIA Pay Application',
            definition: 'The American Institute of Architects (AIA) G702 and G703 forms are the industry-standard pay-application format used on most commercial and many residential bank-financed projects. The G702 is the cover sheet showing total contract value, % complete, and amount requested; the G703 is the line-item schedule of values backing it up.',
            whenToUse: [
              'Your owner or their bank/lender requires AIA-format billing',
              'You need to bill in stages tied to actual completion percentage',
              'Retainage (a % held back until completion) is part of your contract',
            ],
          }}
        />

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
          {carriedFromAppNumber !== null && (
            <View style={styles.carriedRow}>
              <CheckCircle2 size={14} color={themeColors.accent} strokeWidth={2.4} />
              <Text style={styles.carriedText}>
                Carried forward from Pay App #{carriedFromAppNumber} — every line&apos;s &ldquo;from previous&rdquo; amount and the G702 &ldquo;less previous certificates&rdquo; total are pre-filled. Just enter this period&apos;s percent-complete per line.
              </Text>
            </View>
          )}

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
              <Text style={[styles.heroStatValue, { color: themeColors.accent }]}>
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
              placeholderTextColor={themeColors.textMuted}
            />
          </View>
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Architect</Text>
            <TextInput
              style={styles.formInput}
              value={app.architectName ?? ''}
              onChangeText={v => setApp(p => p ? { ...p, architectName: v } : p)}
              placeholder="Optional"
              placeholderTextColor={themeColors.textMuted}
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
              placeholderTextColor={themeColors.textMuted}
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
            <View style={styles.sovHeaderActions}>
              <TouchableOpacity
                onPress={handleSyncFromSchedule}
                style={styles.chip}
                activeOpacity={0.8}
                testID="aia-sync-from-schedule"
              >
                <Text style={styles.chipText}>Sync from schedule</Text>
              </TouchableOpacity>
              <Text style={styles.sectionTitleCount}>{app.lines.length} items</Text>
            </View>
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

          {/* Fintech revenue CTAs — surfaced contextually next to the
              dollar figures. Pay-app moments are the highest-value moment
              for both factoring and lien-waiver products. */}
          {totals.currentPaymentDue > 0 && (
            <>
              <RevenueEarlyAccessCard
                eventKey="revenue.factoring.altline"
                icon={Banknote}
                headline={`Advance ${formatMoney(totals.currentPaymentDue * 0.9)} on this pay app today`}
                body="Owners average 60-83 days to release pay-app funds. Factoring partner fronts up to 90% in 24 hours for 2-4% per 30 days."
                footer="Partner LOI in progress · early access shipping Q3 2026"
                testID="aia-factoring-cta"
              />
              <RevenueEarlyAccessCard
                eventKey="revenue.lien_waiver.escrow"
                icon={FileSignature}
                headline="Auto-generate lien waivers at payment"
                body="When this pay app is funded, MAGE drafts conditional & unconditional waivers for every sub paid out of it. E-sign in one tap. Optional bank-held escrow for big jobs."
                footer="Built on existing lien-waiver tool · escrow needs partner bank"
                testID="aia-lienwaiver-cta"
              />
            </>
          )}
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
              ? <Check size={18} color={themeColors.accent} />
              : <Save size={18} color={themeColors.accent} />
            }
            <Text style={styles.saveBtnText}>
              {savedFlash ? 'Saved to project' : 'Save to project'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.generateBtn, { flex: 1 }]}
            onPress={requestGenerate}
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

      {/* First-use AIA disclaimer — shown once per device, then never again. */}
      <Modal
        visible={showFirstUseDisclaimer}
        transparent
        animationType="fade"
        onRequestClose={dismissFirstUseDisclaimer}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <ShieldAlert size={26} color="#C26A00" />
            </View>
            <Text style={styles.modalTitle}>Heads up — quick legal note</Text>
            <Text style={styles.modalBody}>
              MAGE ID generates draft pay applications styled after AIA G702 / G703.{' '}
              <Text style={styles.modalBodyEmph}>
                AIA® and &quot;AIA Document G702/G703&quot; are registered trademarks of The American Institute of Architects, which is not affiliated with MAGE ID.
              </Text>
              {'\n\n'}
              Some lenders or architects only accept the official AIA Contract Documents. Verify all amounts, retainage, and certification language with the parties involved before submission.
              {'\n\n'}
              <Text style={styles.modalBodyEmph}>
                You are solely responsible for the accuracy of every figure on the document you submit.
              </Text>
            </Text>
            <TouchableOpacity style={styles.modalCta} onPress={dismissFirstUseDisclaimer}>
              <Text style={styles.modalCtaText}>I understand</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Pre-export confirmation — shown every time before generating. */}
      <Modal
        visible={showPreExportConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPreExportConfirm(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <ShieldAlert size={24} color="#C26A00" />
            </View>
            <Text style={styles.modalTitle}>Ready to certify?</Text>
            <Text style={styles.modalBody}>
              Have you reviewed every line item, total, and retainage value on this pay application?
              {'\n\n'}
              <Text style={styles.modalBodyEmph}>
                Once submitted, you certify these figures are accurate. The contractor named on this document is solely responsible for what&apos;s on it.
              </Text>
            </Text>
            <View style={styles.modalCtaRow}>
              <TouchableOpacity
                style={styles.modalCtaSecondary}
                onPress={() => setShowPreExportConfirm(false)}
              >
                <Text style={styles.modalCtaSecondaryText}>Let me re-check</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCta} onPress={handleGenerate}>
                <Text style={styles.modalCtaText}>I&apos;ve reviewed it · Generate</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function Row({ label, value, bold, dim, highlight }: { label: string; value: string; bold?: boolean; dim?: boolean; highlight?: boolean }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.totalsRow}>
      <Text style={[styles.totalsLabel, dim && { color: themeColors.textMuted }]}>{label}</Text>
      <Text style={[
        styles.totalsValue,
        bold && { fontWeight: '700' },
        dim && { color: themeColors.textMuted },
        highlight && { color: themeColors.accent, fontSize: Type.body.fontSize, fontWeight: '800' },
      ]}>
        {value}
      </Text>
    </View>
  );
}

function Divider() {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.totalsDivider} />;
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  // Carry-forward indicator — sits between the hero header and the stats
  // strip. Tells the GC the prior period's billings were rolled in so they
  // know NOT to manually re-enter them.
  carriedRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: themeColors.accent + '12',
    borderWidth: 1,
    borderColor: themeColors.accent + '30',
  },
  carriedText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 17,
    color: themeColors.text,
    fontWeight: '500' as const,
  },
  container: { flex: 1, backgroundColor: themeColors.bg },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: themeColors.bg },
  loadingText: { fontSize: Type.bodyCompact.fontSize, color: themeColors.textMuted },

  hero: {
    margin: 16, padding: 16, borderRadius: Tokens.radius.panel,
    backgroundColor: themeColors.accent + '10',
    borderWidth: 1, borderColor: themeColors.accent + '30',
  },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heroTitleBlock: { flex: 1 },
  heroLabel: { fontSize: 10, color: themeColors.accent, fontWeight: '700', letterSpacing: 1.5, marginBottom: 4 },
  heroTitle: { fontSize: Type.title3.fontSize, fontWeight: '800', color: themeColors.text, marginBottom: 2 },
  heroSub: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted },
  progressBadge: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: themeColors.accent, borderRadius: 50,
    width: 68, height: 68,
  },
  progressBadgeNum: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: '#FFF', lineHeight: 20 },
  progressBadgeLabel: { fontSize: 9, color: '#FFFFFFCC', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  heroStats: { flexDirection: 'row', gap: 12, marginTop: 14 },
  heroStat: { flex: 1, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, padding: 12, borderWidth: 1, borderColor: themeColors.line },
  heroStatLabel: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, fontWeight: '600', marginBottom: 4 },
  heroStatValue: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: themeColors.text },
  heroStatSub: { fontSize: 10, color: themeColors.textMuted, marginTop: 2 },

  section: { marginHorizontal: 16, marginBottom: 20 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: Type.callout.fontSize, fontWeight: '700', color: themeColors.text, marginBottom: 4 },
  sectionTitleCount: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted },
  sovHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionHint: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginBottom: 10, lineHeight: 16 },

  formRow: { marginBottom: 10 },
  formLabel: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginBottom: 4, fontWeight: '600' },
  formInput: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: themeColors.line,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: Type.bodyCompact.fontSize, color: themeColors.text,
  },

  retainageChips: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.sm,
    backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.line,
  },
  chipActive: { backgroundColor: themeColors.accent, borderColor: themeColors.accent },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: themeColors.text },
  chipTextActive: { color: '#FFF' },

  sovCard: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 12,
    marginBottom: 10, borderWidth: 1, borderColor: themeColors.line,
  },
  sovHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  sovItemNoPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.xs,
    backgroundColor: themeColors.accent + '15',
  },
  sovItemNoText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.accent },
  sovDescription: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600', color: themeColors.text, lineHeight: 18 },

  sovValueRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  sovValueCol: { flex: 1 },
  sovValueLabel: { fontSize: 10, color: themeColors.textMuted, fontWeight: '600', marginBottom: 4 },
  sovValueNum: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: themeColors.text },
  sovInput: {
    backgroundColor: themeColors.bg, borderRadius: Tokens.radius.sm, borderWidth: 1, borderColor: themeColors.line,
    paddingHorizontal: 8, paddingVertical: 8, fontSize: Type.footnote.fontSize, color: themeColors.text,
  },

  sovProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sovProgressBar: { flex: 1, height: 6, backgroundColor: themeColors.line, borderRadius: 3, overflow: 'hidden' },
  sovProgressFill: { height: '100%', backgroundColor: themeColors.success, borderRadius: 3 },
  sovProgressPct: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.text, width: 38, textAlign: 'right' },

  sovQuickRow: { flexDirection: 'row', gap: 6 },
  sovQuickBtn: {
    flex: 1, paddingVertical: 6, borderRadius: Tokens.radius.xs,
    backgroundColor: themeColors.bg, alignItems: 'center',
    borderWidth: 1, borderColor: themeColors.line,
  },
  sovQuickText: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: themeColors.text },

  totalsCard: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: themeColors.line,
  },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  totalsLabel: { fontSize: Type.footnote.fontSize, color: themeColors.text },
  totalsValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: themeColors.text },
  totalsDivider: { height: 1, backgroundColor: themeColors.line, marginVertical: 6 },

  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: themeColors.bg,
    borderTopWidth: 1, borderTopColor: themeColors.line,
    paddingHorizontal: 16, paddingTop: 12,
  },
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: themeColors.accent, borderRadius: Tokens.radius.card,
    paddingVertical: 14,
  },
  generateBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: '#FFF' },
  bottomBarRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingHorizontal: 14, paddingVertical: 14, borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.accent + '12',
    borderWidth: 1, borderColor: themeColors.accent + '40',
  },
  saveBtnDone: { backgroundColor: themeColors.accent + '20', borderColor: themeColors.accent },
  saveBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: themeColors.accent },
  bottomBarHint: {
    fontSize: Type.caption2.fontSize, color: themeColors.textMuted, textAlign: 'center',
    marginTop: 8, lineHeight: 15,
  },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(11,13,16,0.55)',
    alignItems: 'center', justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: themeColors.bg,
    borderRadius: 20,
    padding: 24,
    maxWidth: 440, width: '100%',
    borderWidth: 1, borderColor: themeColors.line,
  },
  modalIconWrap: {
    width: 48, height: 48, borderRadius: Tokens.radius.lg,
    backgroundColor: '#FFF4E0',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  },
  modalTitle: { fontSize: Type.title3.fontSize, fontWeight: '800', color: themeColors.text, marginBottom: 12, letterSpacing: -0.3 },
  modalBody: { fontSize: Type.bodyCompact.fontSize, color: themeColors.text, lineHeight: 20 },
  modalBodyEmph: { fontWeight: '700', color: themeColors.text },
  modalCta: {
    backgroundColor: themeColors.text,
    paddingVertical: 13, paddingHorizontal: 18,
    borderRadius: Tokens.radius.card,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 16,
    flex: 1,
  },
  modalCtaText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '700' },
  modalCtaRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalCtaSecondary: {
    backgroundColor: themeColors.surface,
    paddingVertical: 13, paddingHorizontal: 18,
    borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: themeColors.line,
    alignItems: 'center', justifyContent: 'center',
    flex: 1,
  },
  modalCtaSecondaryText: { color: themeColors.text, fontSize: Type.bodyCompact.fontSize, fontWeight: '700' },
});
