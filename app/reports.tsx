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
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform,
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
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useProjects } from '@/contexts/ProjectContext';
import {
  computeWIPReport, computeProfitReport, computeARAgingReport,
  wipReportToCSV, arAgingReportToCSV,
  type ARAgingReport,
} from '@/utils/financialReports';
import { shareWIPReport, shareProfitReport, shareARAgingReport } from '@/utils/financialReportPdf';
import { formatMoney } from '@/utils/formatters';
import { copyToClipboard } from '@/utils/clipboard';
import type { CompanyBranding } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

type Tab = 'wip' | 'profit' | 'aging';

export default function ReportsScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const { projects, invoices, changeOrders, commitments, settings } = useProjects();

  // WIP is the bank-ready Business deliverable — gate it exactly like
  // /wip-report does (canAccess('wip_reporting')). Non-Business users can
  // still open the Profit + A/R Aging tabs; selecting WIP shows the Paywall
  // instead of the report chrome, and WIP export actions are blocked.
  const wipUnlocked = canAccess('wip_reporting');
  // Land sub-Business users on Profit so the default tab isn't a locked wall.
  const [tab, setTab] = useState<Tab>(wipUnlocked ? 'wip' : 'profit');
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
    if (tab === 'wip' && !wipUnlocked) return; // WIP export is Business-gated
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
      showAlert('PDF failed', err instanceof Error ? err.message : 'Could not generate PDF.');
    } finally {
      setGenerating(false);
    }
  }, [tab, wip, profit, aging, branding, wipUnlocked]);

  const handleCopyCsv = useCallback(async () => {
    if (tab === 'wip' && !wipUnlocked) return; // WIP CSV is Business-gated
    const csv = tab === 'wip' ? wipReportToCSV(wip)
              : tab === 'aging' ? arAgingReportToCSV(aging)
              : ''; // profit doesn't ship a CSV — it's tiny + the PDF is the deliverable
    if (!csv) return;
    const ok = await copyToClipboard(csv);
    if (ok) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert(
      ok ? 'Copied' : 'Copy failed',
      ok ? 'CSV is on your clipboard. Paste into Excel/QuickBooks/Sage.' : 'Could not copy CSV.',
    );
  }, [tab, wip, aging, wipUnlocked]);

  // WIP tab selected but tier doesn't unlock it → full-screen Paywall,
  // mirroring app/wip-report.tsx. The report chrome (data, PDF, CSV) never
  // renders, so the Business-only deliverable stays behind the gate.
  const wipLocked = tab === 'wip' && !wipUnlocked;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
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
        {/* Centered icon-circle hero — matches the new design language so
            Reports reads as a sibling of the AI-feature screens. */}
        <View style={styles.reportsHero}>
          <View style={styles.reportsHeroIcon}>
            <TrendingUp size={26} color={themeColors.accent} strokeWidth={1.75} />
          </View>
          <Text style={styles.reportsHeroTitle}>Bank-Ready Reports</Text>
          <Text style={styles.reportsHeroSub}>
            WIP, profit margin, and A/R aging — auto-compiled across every project. Export to CSV or PDF in one tap.
          </Text>
        </View>

        {tab === 'wip' && !wipLocked && <WIPView    report={wip} />}
        {tab === 'profit'               && <ProfitView profit={profit} />}
        {tab === 'aging'                && <AgingView  report={aging} />}
      </ScrollView>

      {/* WIP is Business-only. Render the same Paywall wip-report.tsx uses.
          Closing it drops the user back onto the Profit tab (still usable). */}
      {wipLocked && (
        <Paywall
          visible={true}
          feature="WIP Reporting"
          requiredTier="business"
          onClose={() => setTab('profit')}
        />
      )}

      {/* Action bar — hidden on the locked WIP tab so no WIP export leaks. */}
      {!wipLocked && (
      <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]}>
        {tab !== 'profit' && (
          <TouchableOpacity style={styles.actionBtnSecondary} onPress={handleCopyCsv} activeOpacity={0.85}>
            <Copy size={14} color={themeColors.text} strokeWidth={1.75} />
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
              <FileDown size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.actionBtnPrimaryText}>
                {Platform.OS === 'web' ? 'Open PDF preview' : 'Download & share PDF'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
      )}
    </View>
  );
}

function TabBtn({ label, icon: Icon, active, onPress }: { label: string; icon: typeof TrendingUp; active: boolean; onPress: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity style={[styles.tabBtn, active && styles.tabBtnActive]} onPress={onPress} activeOpacity={0.85}>
      <Icon size={14} color={active ? themeColors.accent : themeColors.textMuted} />
      <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── WIP view ────────────────────────────────────────────────────────

function WIPView({ report }: { report: ReturnType<typeof computeWIPReport> }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
          <SummaryStat label="Revised contract" value={formatMoney(report.totals.revisedContract)} accent={themeColors.text} />
          <SummaryStat label="Billed"            value={formatMoney(report.totals.billedToDate)} accent={themeColors.text} />
          <SummaryStat label="Retainage held"    value={formatMoney(report.totals.retainageHeld)} accent={Colors.warning} />
          <SummaryStat
            label="Projected profit"
            value={formatMoney(report.totals.projectedProfit)}
            accent={report.totals.projectedProfit >= 0 ? themeColors.success : themeColors.danger}
          />
        </View>
      </View>

      {report.rows.map(r => (
        <View key={r.projectId} style={styles.row}>
          <View style={styles.rowHead}>
            <Text style={styles.rowTitle} numberOfLines={1}>{r.projectName}</Text>
            <View style={[styles.marginPill, marginTone(r.projectedMargin, themeColors)]}>
              <Text style={[styles.marginPillText, marginTextTone(r.projectedMargin, themeColors)]}>
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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (profit.rows.length === 0) {
    return <EmptyState icon={TrendingUp} title="No projects yet" body="Profit dashboard pulls live margins across every project. Add one to get started." />;
  }
  return (
    <>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryEyebrow}>RUNNING PORTFOLIO MARGIN</Text>
        <View style={styles.profitHero}>
          <Text style={styles.profitHeroAmount}>{formatMoney(profit.totalProfit)}</Text>
          <Text style={[styles.profitHeroPct, marginTextTone(profit.weightedMargin, themeColors)]}>
            {profit.weightedMargin.toFixed(1)}% margin
          </Text>
        </View>
        <Text style={styles.profitHeroSub}>
          on {formatMoney(profit.totalRevenue)} of revised contract value
        </Text>
      </View>

      <View style={styles.bandRow}>
        <Band color={themeColors.success} label=" ≥ 12% (good)" />
        <Band color={Colors.warning} label=" 5–11% (watch)" />
        <Band color={themeColors.danger}   label=" < 5% (risk)" />
      </View>

      {profit.rows.map(r => (
        <View key={r.projectId} style={styles.row}>
          <View style={styles.rowHead}>
            <View style={[styles.healthDot, healthTone(r.health, themeColors)]} />
            <Text style={styles.rowTitle} numberOfLines={1}>{r.projectName}</Text>
            <View style={[styles.marginPill, marginTone(r.projectedMargin, themeColors)]}>
              <Text style={[styles.marginPillText, marginTextTone(r.projectedMargin, themeColors)]}>
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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.summaryStatItem}>
      <Text style={styles.summaryStatLabel}>{label}</Text>
      <Text style={[styles.summaryStatValue, accent ? { color: accent } : null]}>{value}</Text>
    </View>
  );
}

function KV({ k, v, bold, tone, muted }: { k: string; v: string; bold?: boolean; tone?: 'good' | 'bad'; muted?: boolean }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.kv}>
      <Text style={styles.kvKey}>{k}</Text>
      <Text style={[
        styles.kvVal,
        bold ? styles.kvValBold : null,
        tone === 'good' ? { color: themeColors.success } : null,
        tone === 'bad' ? { color: themeColors.danger } : null,
        muted ? { color: themeColors.textMuted } : null,
      ]}>
        {v}
      </Text>
    </View>
  );
}

function Band({ color, label }: { color: string; label: string }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.band}>
      <View style={[styles.bandDot, { backgroundColor: color }]} />
      <Text style={styles.bandText}>{label}</Text>
    </View>
  );
}

function Bucket({ label, value, tone }: { label: string; value: number; tone: 'muted' | 'warn' | 'bad' }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const color = tone === 'muted' ? themeColors.text : tone === 'warn' ? Colors.warning : themeColors.danger;
  return (
    <View style={styles.bucket}>
      <Text style={styles.bucketLabel}>{label}</Text>
      <Text style={[styles.bucketValue, { color }]}>{formatMoney(value)}</Text>
    </View>
  );
}

function EmptyState({ icon: Icon, title, body, tone }: { icon: typeof TrendingUp; title: string; body: string; tone?: 'good' }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.emptyCard, tone === 'good' ? { backgroundColor: themeColors.success + '0D', borderColor: themeColors.success + '30' } : null]}>
      <Icon size={28} color={tone === 'good' ? themeColors.success : themeColors.textMuted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

// Tone helpers — colour rules for margin and health. Accept ThemeColors so
// dark-mode gets the brighter token variants instead of hardcoded light-mode hex.
function marginTone(pct: number, t: ThemeColors) {
  if (pct >= 12) return { backgroundColor: t.success + '15' };
  if (pct >=  5) return { backgroundColor: Colors.warning + '15' };
  return                 { backgroundColor: t.danger + '15' };
}
function marginTextTone(pct: number, t: ThemeColors) {
  if (pct >= 12) return { color: t.success };
  if (pct >=  5) return { color: Colors.warning };
  return                 { color: t.danger };
}
function healthTone(h: 'green' | 'yellow' | 'red', t: ThemeColors) {
  if (h === 'green')  return { backgroundColor: t.success };
  if (h === 'yellow') return { backgroundColor: Colors.warning };
  return                       { backgroundColor: t.danger };
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  eyebrow: { fontSize: 10, fontWeight: '800', color: t.accent, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: Type.title2.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.4, marginTop: 2 },
  reportsHero: { alignItems: 'center' as const, gap: 6, marginBottom: 18, paddingHorizontal: 8 },
  reportsHeroIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: t.accent + '14',
    alignItems: 'center' as const, justifyContent: 'center' as const,
    marginBottom: 6,
  },
  reportsHeroTitle: { fontSize: 24, fontWeight: '700' as const, color: t.text, letterSpacing: -0.3 },
  reportsHeroSub: { fontSize: Type.bodyCompact.fontSize, color: t.textMuted, textAlign: 'center' as const, lineHeight: 20, paddingHorizontal: 8 },

  tabRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: t.line,
    backgroundColor: t.bg,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 11,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
  },
  tabBtnActive: { backgroundColor: t.accent + '12', borderColor: t.accent },
  tabBtnText:   { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.textMuted },
  tabBtnTextActive: { color: t.accent },

  summaryCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 16,
    borderWidth: 1, borderColor: t.line, marginBottom: 14, gap: 10,
  },
  summaryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryEyebrow: { fontSize: 10, fontWeight: '800', color: t.accent, letterSpacing: 1.2, textTransform: 'uppercase' },
  summaryGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryStatItem: { width: '47%', paddingVertical: 4 },
  summaryStatLabel: { fontSize: 10, fontWeight: '800', color: t.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 },
  summaryStatValue: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.3 },

  profitHero: { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: 4 },
  profitHeroAmount: { fontSize: Type.title1.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.6 },
  profitHeroPct:    { fontSize: Type.callout.fontSize, fontWeight: '800' },
  profitHeroSub:    { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },

  bandRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  band:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bandDot: { width: 8, height: 8, borderRadius: 4 },
  bandText:{ fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' },

  agingHeroAmount: { fontSize: 26, fontWeight: '800', color: t.danger, letterSpacing: -0.6, marginTop: 4 },
  bucketRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  bucket:    { flex: 1, padding: 8, borderRadius: Tokens.radius.sm, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line },
  bucketLabel: { fontSize: 9, fontWeight: '800', color: t.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' },
  bucketValue: { fontSize: Type.caption1.fontSize, fontWeight: '800', marginTop: 3, letterSpacing: -0.2 },
  bucketPill:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full },
  bucketPillMuted: { backgroundColor: t.bg, borderWidth: 1, borderColor: t.line },
  bucketPillWarn:  { backgroundColor: Colors.warning + '15' },
  bucketPillBad:   { backgroundColor: t.danger   + '15' },
  bucketPillText:  { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, color: t.text },

  row: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card, padding: 14,
    borderWidth: 1, borderColor: t.line, marginBottom: 10,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  rowTitle: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  marginPill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: Tokens.radius.full },
  marginPillText: { fontSize: Type.caption2.fontSize, fontWeight: '800', letterSpacing: 0.3 },
  healthDot: { width: 10, height: 10, borderRadius: 5 },

  kvGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kv: { width: '48%', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  kvKey: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' },
  kvVal: { fontSize: Type.caption1.fontSize, color: t.text, fontWeight: '600' },
  kvValBold: { fontWeight: '800', fontSize: Type.footnote.fontSize },

  emptyCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 28,
    alignItems: 'center', gap: 8, marginTop: 22,
    borderWidth: 1, borderColor: t.line,
  },
  emptyTitle: { fontSize: Type.callout.fontSize, fontWeight: '800', color: t.text, marginTop: 4 },
  emptyBody:  { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 320 },

  actionBar: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.surface,
  },
  actionBtnSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, paddingHorizontal: 16, borderRadius: 11,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
  },
  actionBtnSecondaryText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  actionBtnPrimary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 11, backgroundColor: t.accent,
    shadowColor: t.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 10, elevation: 4,
  },
  actionBtnPrimaryText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: '#FFF', letterSpacing: 0.2 },
});
