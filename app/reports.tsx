// Reports — financial reporting hub. Three reports under one roof:
//   • WIP (Work in Progress) — bank-ready
//   • Profit by project — running margin
//   • A/R Aging — open invoices bucketed by days past due
//
// Each tab supports a "Download PDF" CTA (branded, GC-ready) and a
// "Copy CSV" action for the WIP + AR reports so a CFO can paste into
// QuickBooks/Excel/Sage without rekeying.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Platform, Clipboard,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, FileDown, ClipboardList, TrendingUp, AlertTriangle,
  CheckCircle2, ChevronRight, Copy, FileSpreadsheet, ArrowDownToLine,
  DollarSign, Activity, Banknote,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import {
  computeWIPReport, computeProfitReport, computeARAgingReport,
  wipReportToCSV, arAgingReportToCSV,
  type ARAgingReport,
} from '@/utils/financialReports';
import { shareWIPReport, shareProfitReport, shareARAgingReport } from '@/utils/financialReportPdf';
import { formatMoney } from '@/utils/formatters';
import type { CompanyBranding } from '@/types';

type Tab = 'wip' | 'profit' | 'aging';

export default function ReportsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, invoices, changeOrders, commitments, settings } = useProjects();

  const [tab, setTab] = useState<Tab>('wip');
  const [generating, setGenerating] = useState(false);

  const wip    = useMemo(() => computeWIPReport(projects, invoices, changeOrders, commitments), [projects, invoices, changeOrders, commitments]);
  const profit = useMemo(() => computeProfitReport(projects, invoices, changeOrders, commitments), [projects, invoices, changeOrders, commitments]);
  const aging  = useMemo(() => computeARAgingReport(invoices, projects), [invoices, projects]);

  const branding = useMemo<CompanyBranding>(() => ({
    companyName:   settings?.branding?.companyName ?? 'MAGE ID',
    contactName:   settings?.branding?.contactName ?? '',
    phone:         settings?.branding?.phone ?? '',
    email:         settings?.branding?.email ?? '',
    address:       settings?.branding?.address ?? '',
    licenseNumber: settings?.branding?.licenseNumber ?? '',
    tagline:       settings?.branding?.tagline ?? '',
    logoUri:       settings?.branding?.logoUri,
  }), [settings]);

  const handleSharePdf = useCallback(async () => {
    setGenerating(true);
    try {
      if (tab === 'wip') {
        await shareWIPReport(wip, branding);
      } else if (tab === 'profit') {
        await shareProfitReport(profit.rows, profit.totalRevenue, profit.totalProfit, profit.weightedMargin, branding);
      } else {
        await shareARAgingReport(aging, branding);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('PDF failed', err instanceof Error ? err.message : 'Could not generate PDF.');
    } finally {
      setGenerating(false);
    }
  }, [tab, wip, profit, aging, branding]);

  const handleCopyCsv = useCallback(async () => {
    try {
      const csv = tab === 'wip' ? wipReportToCSV(wip)
                : tab === 'aging' ? arAgingReportToCSV(aging)
                : ''; // profit doesn't ship a CSV — it's tiny + the PDF is the deliverable
      if (!csv) return;
      Clipboard.setString(csv);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Copied', 'CSV is on your clipboard. Paste into Excel/QuickBooks/Sage.');
    } catch (err) {
      Alert.alert('Copy failed', err instanceof Error ? err.message : 'Could not copy CSV.');
    }
  }, [tab, wip, aging]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={26} color={Colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Financial Reports</Text>
          <Text style={styles.title}>Bank-Ready Reports</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TabBtn label="WIP"      icon={ClipboardList} active={tab === 'wip'}    onPress={() => setTab('wip')} />
        <TabBtn label="Profit"   icon={TrendingUp}    active={tab === 'profit'} onPress={() => setTab('profit')} />
        <TabBtn label="A/R Aging" icon={AlertTriangle} active={tab === 'aging'}  onPress={() => setTab('aging')} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}>
        {tab === 'wip'    && <WIPView    report={wip} />}
        {tab === 'profit' && <ProfitView profit={profit} />}
        {tab === 'aging'  && <AgingView  report={aging} />}
      </ScrollView>

      {/* Action bar */}
      <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]}>
        {tab !== 'profit' && (
          <TouchableOpacity style={styles.actionBtnSecondary} onPress={handleCopyCsv} activeOpacity={0.85}>
            <Copy size={14} color={Colors.text} />
            <Text style={styles.actionBtnSecondaryText}>Copy CSV</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.actionBtnPrimary, tab === 'profit' && { flex: 1 }]}
          onPress={handleSharePdf}
          disabled={generating}
          activeOpacity={0.85}
        >
          {generating ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <>
              <FileDown size={16} color="#FFF" />
              <Text style={styles.actionBtnPrimaryText}>
                {Platform.OS === 'web' ? 'Open PDF preview' : 'Download & share PDF'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function TabBtn({ label, icon: Icon, active, onPress }: { label: string; icon: typeof TrendingUp; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.tabBtn, active && styles.tabBtnActive]} onPress={onPress} activeOpacity={0.85}>
      <Icon size={14} color={active ? Colors.primary : Colors.textMuted} />
      <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── WIP view ────────────────────────────────────────────────────────

function WIPView({ report }: { report: ReturnType<typeof computeWIPReport> }) {
  if (report.rows.length === 0) {
    return <EmptyState icon={ClipboardList} title="No active projects" body="WIP reports compile across active projects. Add or activate a project to populate this report." />;
  }
  return (
    <>
      {/* Portfolio header */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryHead}>
          <Text style={styles.summaryEyebrow}>WIP TOTAL — {report.rows.length} project{report.rows.length === 1 ? '' : 's'}</Text>
        </View>
        <View style={styles.summaryGrid}>
          <SummaryStat label="Revised contract" value={formatMoney(report.totals.revisedContract)} accent={Colors.text} />
          <SummaryStat label="Billed"            value={formatMoney(report.totals.billedToDate)} accent={Colors.text} />
          <SummaryStat label="Retainage held"    value={formatMoney(report.totals.retainageHeld)} accent={Colors.warning} />
          <SummaryStat
            label="Projected profit"
            value={formatMoney(report.totals.projectedProfit)}
            accent={report.totals.projectedProfit >= 0 ? Colors.success : Colors.error}
          />
        </View>
      </View>

      {report.rows.map(r => (
        <View key={r.projectId} style={styles.row}>
          <View style={styles.rowHead}>
            <Text style={styles.rowTitle} numberOfLines={1}>{r.projectName}</Text>
            <View style={[styles.marginPill, marginTone(r.projectedMargin)]}>
              <Text style={[styles.marginPillText, marginTextTone(r.projectedMargin)]}>
                {r.projectedMargin.toFixed(1)}%
              </Text>
            </View>
          </View>

          <View style={styles.kvGrid}>
            <KV k="Contract"        v={formatMoney(r.contractValue)} />
            <KV k="Approved COs"    v={formatMoney(r.approvedChangeOrders)} />
            <KV k="Revised"         v={formatMoney(r.revisedContract)} bold />
            <KV k="% Complete"      v={`${r.percentComplete.toFixed(0)}%`} />
            <KV k="Billed"          v={formatMoney(r.billedToDate)} />
            <KV k="Paid"            v={formatMoney(r.paidToDate)} />
            <KV k="Retainage"       v={formatMoney(r.retainageHeld)} muted={r.retainageHeld === 0} />
            <KV k="Est. final cost" v={formatMoney(r.estimatedFinalCost)} />
            <KV k="Projected profit"
                v={formatMoney(r.projectedProfit)}
                tone={r.projectedProfit >= 0 ? 'good' : 'bad'}
                bold />
          </View>
        </View>
      ))}
    </>
  );
}

// ─── Profit view ─────────────────────────────────────────────────────

function ProfitView({ profit }: { profit: ReturnType<typeof computeProfitReport> }) {
  if (profit.rows.length === 0) {
    return <EmptyState icon={TrendingUp} title="No projects yet" body="Profit dashboard pulls live margins across every project. Add one to get started." />;
  }
  return (
    <>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryEyebrow}>RUNNING PORTFOLIO MARGIN</Text>
        <View style={styles.profitHero}>
          <Text style={styles.profitHeroAmount}>{formatMoney(profit.totalProfit)}</Text>
          <Text style={[styles.profitHeroPct, marginTextTone(profit.weightedMargin)]}>
            {profit.weightedMargin.toFixed(1)}% margin
          </Text>
        </View>
        <Text style={styles.profitHeroSub}>
          on {formatMoney(profit.totalRevenue)} of revised contract value
        </Text>
      </View>

      <View style={styles.bandRow}>
        <Band color={Colors.success} label=" ≥ 12% (good)" />
        <Band color={Colors.warning} label=" 5–11% (watch)" />
        <Band color={Colors.error}   label=" < 5% (risk)" />
      </View>

      {profit.rows.map(r => (
        <View key={r.projectId} style={styles.row}>
          <View style={styles.rowHead}>
            <View style={[styles.healthDot, healthTone(r.health)]} />
            <Text style={styles.rowTitle} numberOfLines={1}>{r.projectName}</Text>
            <View style={[styles.marginPill, marginTone(r.projectedMargin)]}>
              <Text style={[styles.marginPillText, marginTextTone(r.projectedMargin)]}>
                {r.projectedMargin.toFixed(1)}%
              </Text>
            </View>
          </View>
          <View style={styles.kvGrid}>
            <KV k="Revenue"         v={formatMoney(r.revenue)} />
            <KV k="Cost to date"    v={formatMoney(r.costToDate)} />
            <KV k="Est. final cost" v={formatMoney(r.estimatedFinalCost)} />
            <KV k="Projected profit" v={formatMoney(r.projectedProfit)}
                tone={r.projectedProfit >= 0 ? 'good' : 'bad'} bold />
          </View>
        </View>
      ))}
    </>
  );
}

// ─── AR Aging view ───────────────────────────────────────────────────

function AgingView({ report }: { report: ARAgingReport }) {
  if (report.rows.length === 0) {
    return <EmptyState
      icon={CheckCircle2}
      title="No outstanding invoices"
      body="Every invoice is fully paid. Nice work."
      tone="good"
    />;
  }
  return (
    <>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryEyebrow}>OUTSTANDING — {report.rows.length} invoice{report.rows.length === 1 ? '' : 's'}</Text>
        <Text style={styles.agingHeroAmount}>{formatMoney(report.totals.totalOutstanding)}</Text>
        <View style={styles.bucketRow}>
          <Bucket label="Current" value={report.totals.current}     tone="muted" />
          <Bucket label="0–30"    value={report.totals['0-30']}      tone="warn" />
          <Bucket label="31–60"   value={report.totals['31-60']}     tone="warn" />
          <Bucket label="61–90"   value={report.totals['61-90']}     tone="bad" />
          <Bucket label="90+"     value={report.totals['90+']}       tone="bad" />
        </View>
      </View>

      {report.rows.map(r => {
        const bucketStyle =
          r.bucket === 'current' ? styles.bucketPillMuted :
          r.bucket === '0-30'    ? styles.bucketPillWarn :
          r.bucket === '31-60'   ? styles.bucketPillWarn :
                                   styles.bucketPillBad;
        return (
          <View key={r.invoiceId} style={styles.row}>
            <View style={styles.rowHead}>
              <Text style={styles.rowTitle}>#{r.invoiceNumber} · {r.projectName}</Text>
              <View style={[styles.bucketPill, bucketStyle]}>
                <Text style={styles.bucketPillText}>
                  {r.bucket === 'current' ? 'Current' : `${r.daysPastDue}d past due`}
                </Text>
              </View>
            </View>
            <View style={styles.kvGrid}>
              <KV k="Issued"       v={new Date(r.issueDate).toLocaleDateString()} />
              <KV k="Due"          v={new Date(r.dueDate).toLocaleDateString()} />
              <KV k="Total due"    v={formatMoney(r.totalDue)} />
              <KV k="Paid"         v={formatMoney(r.amountPaid)} />
              <KV k="Outstanding"  v={formatMoney(r.outstanding)} bold tone="bad" />
            </View>
          </View>
        );
      })}
    </>
  );
}

// ─── Tiny presentational components ──────────────────────────────────

function SummaryStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.summaryStatItem}>
      <Text style={styles.summaryStatLabel}>{label}</Text>
      <Text style={[styles.summaryStatValue, accent ? { color: accent } : null]}>{value}</Text>
    </View>
  );
}

function KV({ k, v, bold, tone, muted }: { k: string; v: string; bold?: boolean; tone?: 'good' | 'bad'; muted?: boolean }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvKey}>{k}</Text>
      <Text style={[
        styles.kvVal,
        bold ? styles.kvValBold : null,
        tone === 'good' ? { color: Colors.success } : null,
        tone === 'bad' ? { color: Colors.error } : null,
        muted ? { color: Colors.textMuted } : null,
      ]}>
        {v}
      </Text>
    </View>
  );
}

function Band({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.band}>
      <View style={[styles.bandDot, { backgroundColor: color }]} />
      <Text style={styles.bandText}>{label}</Text>
    </View>
  );
}

function Bucket({ label, value, tone }: { label: string; value: number; tone: 'muted' | 'warn' | 'bad' }) {
  const color = tone === 'muted' ? Colors.text : tone === 'warn' ? Colors.warning : Colors.error;
  return (
    <View style={styles.bucket}>
      <Text style={styles.bucketLabel}>{label}</Text>
      <Text style={[styles.bucketValue, { color }]}>{formatMoney(value)}</Text>
    </View>
  );
}

function EmptyState({ icon: Icon, title, body, tone }: { icon: typeof TrendingUp; title: string; body: string; tone?: 'good' }) {
  return (
    <View style={[styles.emptyCard, tone === 'good' ? { backgroundColor: Colors.success + '0D', borderColor: Colors.success + '30' } : null]}>
      <Icon size={28} color={tone === 'good' ? Colors.success : Colors.textMuted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

// Tone helpers — colour rules for margin and health.
function marginTone(pct: number) {
  if (pct >= 12) return { backgroundColor: Colors.success + '15' };
  if (pct >=  5) return { backgroundColor: Colors.warning + '15' };
  return                 { backgroundColor: Colors.error   + '15' };
}
function marginTextTone(pct: number) {
  if (pct >= 12) return { color: Colors.success };
  if (pct >=  5) return { color: Colors.warning };
  return                 { color: Colors.error };
}
function healthTone(h: 'green' | 'yellow' | 'red') {
  if (h === 'green')  return { backgroundColor: Colors.success };
  if (h === 'yellow') return { backgroundColor: Colors.warning };
  return                       { backgroundColor: Colors.error };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  eyebrow: { fontSize: 10, fontWeight: '800', color: Colors.primary, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: 22, fontWeight: '800', color: Colors.text, letterSpacing: -0.4, marginTop: 2 },

  tabRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 11,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  tabBtnActive: { backgroundColor: Colors.primary + '12', borderColor: Colors.primary },
  tabBtnText:   { fontSize: 13, fontWeight: '700', color: Colors.textMuted },
  tabBtnTextActive: { color: Colors.primary },

  summaryCard: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 14, gap: 10,
  },
  summaryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryEyebrow: { fontSize: 10, fontWeight: '800', color: Colors.primary, letterSpacing: 1.2, textTransform: 'uppercase' },
  summaryGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryStatItem: { width: '47%', paddingVertical: 4 },
  summaryStatLabel: { fontSize: 10, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 },
  summaryStatValue: { fontSize: 18, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },

  profitHero: { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: 4 },
  profitHeroAmount: { fontSize: 28, fontWeight: '800', color: Colors.text, letterSpacing: -0.6 },
  profitHeroPct:    { fontSize: 16, fontWeight: '800' },
  profitHeroSub:    { fontSize: 12, color: Colors.textMuted, marginTop: 2 },

  bandRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  band:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bandDot: { width: 8, height: 8, borderRadius: 4 },
  bandText:{ fontSize: 11, color: Colors.textMuted, fontWeight: '600' },

  agingHeroAmount: { fontSize: 26, fontWeight: '800', color: Colors.error, letterSpacing: -0.6, marginTop: 4 },
  bucketRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  bucket:    { flex: 1, padding: 8, borderRadius: 8, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  bucketLabel: { fontSize: 9, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' },
  bucketValue: { fontSize: 12, fontWeight: '800', marginTop: 3, letterSpacing: -0.2 },
  bucketPill:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  bucketPillMuted: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  bucketPillWarn:  { backgroundColor: Colors.warning + '15' },
  bucketPillBad:   { backgroundColor: Colors.error   + '15' },
  bucketPillText:  { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, color: Colors.text },

  row: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 10,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  rowTitle: { flex: 1, fontSize: 14, fontWeight: '800', color: Colors.text, letterSpacing: -0.2 },
  marginPill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  marginPillText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  healthDot: { width: 10, height: 10, borderRadius: 5 },

  kvGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kv: { width: '48%', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  kvKey: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' },
  kvVal: { fontSize: 12, color: Colors.text, fontWeight: '600' },
  kvValBold: { fontWeight: '800', fontSize: 13 },

  emptyCard: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 28,
    alignItems: 'center', gap: 8, marginTop: 22,
    borderWidth: 1, borderColor: Colors.border,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: Colors.text, marginTop: 4 },
  emptyBody:  { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 320 },

  actionBar: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.surface,
  },
  actionBtnSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, paddingHorizontal: 16, borderRadius: 11,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  actionBtnSecondaryText: { fontSize: 13, fontWeight: '700', color: Colors.text },
  actionBtnPrimary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 11, backgroundColor: Colors.primary,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 10, elevation: 4,
  },
  actionBtnPrimaryText: { fontSize: 14, fontWeight: '800', color: '#FFF', letterSpacing: 0.2 },
});
