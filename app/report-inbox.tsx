// Report Inbox — cross-project view of every report-shaped artifact
// (DFR, RFI, Submittal, Invoice, Change Order). The audit pitched this
// as the "premium" move that takes report management from "open project,
// drill down, find item" to "search across everything in one place."
//
// Why: when a contractor runs 4 jobs simultaneously, they don't think
// "I need to find Project X's RFI #3" — they think "did the architect
// answer that thing yet?" or "what's still open across all my projects?"
// This screen flips the org axis from project→type to type→project.
//
// Data is denormalized at render time from ProjectContext — no new
// persisted state. Filter chips at the top (Type and Status) plus a
// project picker mean the user can slice by any axis they care about.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, FileText, ClipboardList, Receipt, Repeat, ChevronRight, AlertTriangle, ArrowDownRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import FilterChipRow, { type FilterChip } from '@/components/FilterChipRow';
import EmptyState from '@/components/EmptyState';
import { formatMoney } from '@/utils/formatters';

type ReportKind = 'all' | 'dfr' | 'rfi' | 'submittal' | 'invoice' | 'changeOrder';
type StatusFilter = 'all' | 'open' | 'closed' | 'overdue';

interface InboxRow {
  key: string;
  kind: Exclude<ReportKind, 'all'>;
  projectId: string;
  projectName: string;
  primary: string;
  secondary: string;
  badgeText: string;
  badgeColor: string;
  badgeBg: string;
  timestamp: number;
  overdue: boolean;
  href: string;
  hrefParams: Record<string, string>;
}

export default function ReportInboxScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, dailyReports, rfis, submittals, invoices, changeOrders } = useProjects();

  const [kindFilter, setKindFilter] = useState<ReportKind>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');

  const projectsById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);

  const rows: InboxRow[] = useMemo(() => {
    const list: InboxRow[] = [];

    for (const dr of dailyReports) {
      const proj = projectsById.get(dr.projectId);
      if (!proj) continue;
      const ts = new Date(dr.date).getTime();
      list.push({
        key: `dfr-${dr.id}`,
        kind: 'dfr',
        projectId: dr.projectId,
        projectName: proj.name,
        primary: new Date(dr.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        secondary: `${dr.weather?.conditions || 'No weather'} · ${dr.manpower.reduce((s: number, m: { headcount: number }) => s + m.headcount, 0)} workers`,
        badgeText: dr.status === 'sent' ? 'Sent' : 'Saved',
        badgeColor: dr.status === 'sent' ? Colors.success : Colors.primary,
        badgeBg: dr.status === 'sent' ? Colors.successLight : Colors.primary + '15',
        timestamp: Number.isFinite(ts) ? ts : 0,
        overdue: false,
        href: '/daily-report',
        hrefParams: { projectId: dr.projectId, reportId: dr.id },
      });
    }

    for (const r of rfis) {
      const proj = projectsById.get(r.projectId);
      if (!proj) continue;
      const required = r.dateRequired ? new Date(r.dateRequired).getTime() : NaN;
      const overdue = r.status === 'open' && Number.isFinite(required) && required < Date.now();
      list.push({
        key: `rfi-${r.id}`,
        kind: 'rfi',
        projectId: r.projectId,
        projectName: proj.name,
        primary: `RFI #${r.number}: ${r.subject}`,
        secondary: `${r.assignedTo || 'Unassigned'} · ${r.priority}`,
        badgeText: r.status.charAt(0).toUpperCase() + r.status.slice(1),
        badgeColor:
          r.status === 'open' ? Colors.warning :
          r.status === 'answered' ? Colors.info :
          r.status === 'closed' ? Colors.success : Colors.textSecondary,
        badgeBg:
          r.status === 'open' ? Colors.warningLight :
          r.status === 'answered' ? Colors.infoLight :
          r.status === 'closed' ? Colors.successLight : Colors.fillTertiary,
        timestamp: new Date(r.dateSubmitted ?? r.createdAt).getTime(),
        overdue,
        href: '/rfi',
        hrefParams: { projectId: r.projectId, rfiId: r.id },
      });
    }

    for (const s of submittals) {
      const proj = projectsById.get(s.projectId);
      if (!proj) continue;
      list.push({
        key: `sub-${s.id}`,
        kind: 'submittal',
        projectId: s.projectId,
        projectName: proj.name,
        primary: `Submittal #${s.number}: ${s.title}`,
        secondary: `${s.specSection || 'No spec'} · ${s.reviewCycles.length} cycle${s.reviewCycles.length === 1 ? '' : 's'}`,
        badgeText: s.currentStatus.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        badgeColor:
          s.currentStatus === 'approved' ? Colors.success :
          s.currentStatus === 'rejected' || s.currentStatus === 'revise_resubmit' ? Colors.error :
          s.currentStatus === 'in_review' ? Colors.info :
          Colors.warning,
        badgeBg:
          s.currentStatus === 'approved' ? Colors.successLight :
          s.currentStatus === 'rejected' || s.currentStatus === 'revise_resubmit' ? Colors.errorLight :
          s.currentStatus === 'in_review' ? Colors.infoLight :
          Colors.warningLight,
        timestamp: new Date(s.submittedDate ?? s.createdAt).getTime(),
        overdue: false,
        href: '/submittal',
        hrefParams: { projectId: s.projectId, submittalId: s.id },
      });
    }

    for (const inv of invoices) {
      const proj = projectsById.get(inv.projectId);
      if (!proj) continue;
      const balance = inv.totalDue - inv.amountPaid;
      const overdue = balance > 0 && inv.dueDate && new Date(inv.dueDate).getTime() < Date.now();
      const status = balance <= 0 ? 'paid' : overdue ? 'overdue' : 'unpaid';
      list.push({
        key: `inv-${inv.id}`,
        kind: 'invoice',
        projectId: inv.projectId,
        projectName: proj.name,
        primary: `${inv.type === 'progress' ? 'Progress Bill' : 'Invoice'} #${inv.number}`,
        secondary: `${formatMoney(inv.totalDue)} · Due ${new Date(inv.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        badgeText: status.charAt(0).toUpperCase() + status.slice(1),
        badgeColor: status === 'paid' ? Colors.success : status === 'overdue' ? Colors.error : Colors.warning,
        badgeBg: status === 'paid' ? Colors.successLight : status === 'overdue' ? Colors.errorLight : Colors.warningLight,
        timestamp: new Date(inv.issueDate ?? inv.createdAt).getTime(),
        overdue: !!overdue,
        href: '/invoice',
        hrefParams: { projectId: inv.projectId, invoiceId: inv.id },
      });
    }

    for (const co of changeOrders) {
      const proj = projectsById.get(co.projectId);
      if (!proj) continue;
      list.push({
        key: `co-${co.id}`,
        kind: 'changeOrder',
        projectId: co.projectId,
        projectName: proj.name,
        primary: `CO #${co.number}: ${co.description.slice(0, 40)}${co.description.length > 40 ? '…' : ''}`,
        secondary: `${formatMoney(co.changeAmount)} · ${(co.scheduleImpactDays ?? 0) > 0 ? `+${co.scheduleImpactDays}d` : 'no schedule impact'}`,
        badgeText: co.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        badgeColor:
          co.status === 'approved' ? Colors.success :
          co.status === 'rejected' || co.status === 'void' ? Colors.error :
          co.status === 'under_review' ? Colors.info :
          Colors.warning,
        badgeBg:
          co.status === 'approved' ? Colors.successLight :
          co.status === 'rejected' || co.status === 'void' ? Colors.errorLight :
          co.status === 'under_review' ? Colors.infoLight :
          Colors.warningLight,
        timestamp: new Date(co.createdAt).getTime(),
        overdue: false,
        href: '/change-order',
        hrefParams: { projectId: co.projectId, coId: co.id },
      });
    }

    return list.sort((a, b) => b.timestamp - a.timestamp);
  }, [dailyReports, rfis, submittals, invoices, changeOrders, projectsById]);

  const counts = useMemo(() => ({
    all: rows.length,
    dfr: rows.filter(r => r.kind === 'dfr').length,
    rfi: rows.filter(r => r.kind === 'rfi').length,
    submittal: rows.filter(r => r.kind === 'submittal').length,
    invoice: rows.filter(r => r.kind === 'invoice').length,
    changeOrder: rows.filter(r => r.kind === 'changeOrder').length,
  }), [rows]);

  const filtered = useMemo(() => rows.filter(r => {
    if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
    if (projectFilter !== 'all' && r.projectId !== projectFilter) return false;
    if (statusFilter === 'open') {
      const openText = r.badgeText.toLowerCase();
      if (!['open', 'pending', 'unpaid', 'in review', 'draft', 'under review', 'saved'].includes(openText)) return false;
    }
    if (statusFilter === 'closed') {
      const t = r.badgeText.toLowerCase();
      if (!['closed', 'paid', 'approved', 'sent'].some(k => t.includes(k))) return false;
    }
    if (statusFilter === 'overdue' && !r.overdue) return false;
    return true;
  }), [rows, kindFilter, projectFilter, statusFilter]);

  const kindChips: FilterChip<ReportKind>[] = [
    { value: 'all', label: 'All', count: counts.all },
    { value: 'dfr', label: 'DFRs', count: counts.dfr },
    { value: 'rfi', label: 'RFIs', count: counts.rfi },
    { value: 'submittal', label: 'Submittals', count: counts.submittal },
    { value: 'invoice', label: 'Invoices', count: counts.invoice },
    { value: 'changeOrder', label: 'COs', count: counts.changeOrder },
  ];

  const statusChips: FilterChip<StatusFilter>[] = [
    { value: 'all', label: 'Any status' },
    { value: 'open', label: 'Open / Unpaid', color: Colors.warning },
    { value: 'overdue', label: 'Overdue', color: Colors.error },
    { value: 'closed', label: 'Closed / Paid', color: Colors.success },
  ];

  const projectChips: FilterChip<string>[] = [
    { value: 'all', label: 'All projects' },
    ...projects.map(p => ({ value: p.id, label: p.name.length > 18 ? p.name.slice(0, 17) + '…' : p.name })),
  ];

  const renderRow = ({ item }: { item: InboxRow }) => {
    const Icon = item.kind === 'dfr' ? ClipboardList
      : item.kind === 'rfi' ? FileText
      : item.kind === 'submittal' ? FileText
      : item.kind === 'invoice' ? Receipt
      : Repeat;
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
          router.push({ pathname: item.href as any, params: item.hrefParams });
        }}
        activeOpacity={0.7}
        testID={`inbox-row-${item.key}`}
      >
        <View style={[styles.rowIcon, { backgroundColor: item.badgeBg }]}>
          <Icon size={16} color={item.badgeColor} />
        </View>
        <View style={styles.rowMain}>
          <Text style={styles.rowPrimary} numberOfLines={1}>{item.primary}</Text>
          <Text style={styles.rowProject} numberOfLines={1}>{item.projectName}</Text>
          <Text style={styles.rowSecondary} numberOfLines={1}>{item.secondary}</Text>
        </View>
        <View style={styles.rowRight}>
          {item.overdue && (
            <View style={styles.overduePill}>
              <AlertTriangle size={10} color={Colors.error} />
              <Text style={styles.overduePillText}>OVERDUE</Text>
            </View>
          )}
          <View style={[styles.badge, { backgroundColor: item.badgeBg }]}>
            <Text style={[styles.badgeText, { color: item.badgeColor }]}>{item.badgeText}</Text>
          </View>
          <ChevronRight size={14} color={Colors.textMuted} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Report Inbox',
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
            <ChevronLeft size={22} color={Colors.primary} />
            <Text style={styles.headerBackText}>Back</Text>
          </TouchableOpacity>
        ),
      }} />

      {/* Native nav header (Stack.Screen above) already handles insets.top.
          The previous insets.top + 56 added a redundant ~110px of space
          below the header. Just give the filter bar a comfortable inset. */}
      <View style={[styles.filtersBar, { paddingTop: 12 }]}>
        <FilterChipRow chips={kindChips} value={kindFilter} onChange={setKindFilter} />
        <FilterChipRow chips={statusChips} value={statusFilter} onChange={setStatusFilter} />
        {projects.length > 1 && (
          <FilterChipRow chips={projectChips} value={projectFilter} onChange={setProjectFilter} />
        )}
      </View>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ArrowDownRight size={32} color={Colors.primary} />}
          title="Nothing in this slice"
          message="Try a different filter combo above — or jump back to a project to create a new invoice, change order, or daily report."
          actionLabel="Back to projects"
          onAction={() => router.replace('/(tabs)/(home)' as never)}
        />
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderRow}
          keyExtractor={item => item.key}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 30 }]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerBack: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 6, paddingLeft: 4, minWidth: 72 },
  headerBackText: { fontSize: 16, fontWeight: '500', color: Colors.primary },
  filtersBar: { backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight, paddingBottom: 4 },
  listContent: { padding: 12, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: Colors.cardBorder },
  rowIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowMain: { flex: 1 },
  rowPrimary: { fontSize: 14, fontWeight: '700', color: Colors.text },
  rowProject: { fontSize: 11, color: Colors.textMuted, fontWeight: '600', marginTop: 1 },
  rowSecondary: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  overduePill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.errorLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  overduePillText: { fontSize: 9, fontWeight: '800', color: Colors.error, letterSpacing: 0.5 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  emptySub: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', maxWidth: 280 },
});
