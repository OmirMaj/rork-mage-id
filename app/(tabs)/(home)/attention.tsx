// app/(tabs)/(home)/attention.tsx — /attention, the whole "needs attention" list.
//
// WHY (wave 6c, lane F). The desktop action rail shows the first 8 of the
// canonical attention set and three short sections (ready to bill, daily-log
// gaps, warranty walks). Its '+N more' used to be plain text that went
// nowhere; its 'See all N' now links here. This page is the same four lists,
// complete, one table each, switched by ?view= (needs | bill | logs |
// warranty) so every view is a URL a GC can bookmark or Cmd-click.
//
// ONE SOURCE PER LIST, the same ones the rail and the Home cards read:
//   needs    — useBrainWatch() (the canonical set: the tab badge's number)
//   bill     — utils/draftedRevenue buildReadyToBill (ReadyToBillCard)
//   logs     — utils/portfolio/attentionRows buildDailyLogGaps (DailyLogCard)
//   warranty — utils/warrantyWalks getUpcomingWarrantyWalks (WarrantyWalkBanner)
// The 'needs' view keeps the rail's three empty states word for word: a failed
// read is not "all caught up", and an overdue RFI or submittal (outside the
// canonical scan) routes to /waiting-on instead of being swallowed.
//
// It lives in the Home tab's stack (headerShown false there), so it draws its
// own PageHeader and a Back row when there is somewhere to go back to. On
// desktop the tabs frame caps it at Layout.page.table (TAB_PAGE_TYPE['(home)']);
// the action rail is off here (actionRailVisible: segments[2] === 'attention').
// On a phone DataTable renders the simple cards, so a deep link works; no
// phone entry point is added.

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle2, ChevronLeft, ChevronRight, CloudOff, MessageSquareWarning } from 'lucide-react-native';
import PageHeader from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/desktop/DataTable';
import { routeHref } from '@/components/desktop/RowLink';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { cardSurface } from '@/components/ui';
import { Tokens } from '@/constants/designTokens';
import { useBrainWatch } from '@/hooks/useBrainWatch';
import { useProjects } from '@/contexts/ProjectContext';
import { rfiAttention, submittalAttention, type AttentionItem, type AttnKind, type AttnSeverity } from '@/utils/brainWatch';
import { buildReadyToBill, type DraftedCORow } from '@/utils/draftedRevenue';
import { getUpcomingWarrantyWalks, warrantyWalkTitle, type WarrantyWalkAlert } from '@/utils/warrantyWalks';
import { resolveWarrantyMonths } from '@/utils/paymentTerms';
import { formatMoney } from '@/utils/formatters';
import { formatCalendarDay } from '@/utils/calendarDate';
import {
  buildDailyLogGaps, dailyLogGapLine, dailyLogGapTarget, parseAttentionView,
  type AttentionView, type DailyLogGapRow,
} from '@/utils/portfolio/attentionRows';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';

export { RouteErrorFallback as ErrorBoundary } from '@/components/ErrorBoundary';

/** Same wording as the rail and BrainWatchCard (RT-R1). */
const UNREACHABLE_LINE =
  `Couldn't reach MAGE — showing what's on this ${Platform.OS === 'web' ? 'device' : 'phone'}`;

const SEVERITY_RANK: Record<AttnSeverity, number> = { critical: 0, high: 1, medium: 2 };
const SEVERITY_LABEL: Record<AttnSeverity, string> = { critical: 'Critical', high: 'High', medium: 'Medium' };

const KIND_LABEL: Record<AttnKind, string> = {
  schedule: 'Schedule',
  invoice: 'Invoice',
  permit: 'Permit',
  cert: 'Certificate',
  closeout: 'Closeout',
  punch: 'Punch list',
  changeOrder: 'Change order',
  delivery: 'Delivery',
  buildingAccess: 'Building access',
  rfi: 'RFI',
  submittal: 'Submittal',
};

const VIEW_LABEL: Record<AttentionView, string> = {
  needs: 'Needs you',
  bill: 'Ready to bill',
  logs: 'Daily-log gaps',
  warranty: 'Warranty walks',
};

type SeverityFilter = 'all' | 'critical' | 'high';

function severityInk(s: AttnSeverity, t: ThemeColors): string {
  if (s === 'critical') return t.danger;
  if (s === 'high') return t.warningLabel;
  return t.textSecondary;
}

/** The message without its leading "Project name: " — the Job column says it. */
function itemText(item: AttentionItem): string {
  const prefix = `${item.projectName}: `;
  return item.message.startsWith(prefix) ? item.message.slice(prefix.length) : item.message;
}

function itemHref(item: AttentionItem): Href {
  return routeHref(item.route.pathname, item.route.params);
}

function cleanParams(o: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

function dayLabel(iso: string): string {
  return formatCalendarDay(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—';
}

export default function AttentionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const params = useLocalSearchParams<{ view?: string }>();
  const view = parseAttentionView(params.view);
  const [severity, setSeverity] = useState<SeverityFilter>('all');

  const { items, sourceFailed } = useBrainWatch();
  const { projects, rfis, submittals, changeOrders, dailyReports, settings } = useProjects();

  // The rail's inline check, kept inline as the rail keeps it: RFIs and
  // submittals the canonical set does not count gate the all-clear sentence.
  const outsideTheScan = useMemo(() => {
    const nowMs = Date.now();
    let n = 0;
    for (const project of projects) {
      if (project.status === 'closed' || project.status === 'completed') continue;
      n += rfiAttention(project, rfis, nowMs).length;
      n += submittalAttention(project, submittals, nowMs).length;
    }
    return n;
  }, [projects, rfis, submittals]);

  // Job order first, so the table's stable severity sort breaks ties by job.
  const needsRows = useMemo(
    () => [...items].sort((a, b) => a.projectName.localeCompare(b.projectName)),
    [items],
  );
  const needsShown = useMemo(
    () => (severity === 'all' ? needsRows : needsRows.filter((i) => i.severity === severity)),
    [needsRows, severity],
  );
  const ready = useMemo(
    () => buildReadyToBill({ changeOrders, projects, nowMs: Date.now() }),
    [changeOrders, projects],
  );
  const logRows = useMemo(
    () => buildDailyLogGaps(projects, dailyReports, new Date().toISOString()),
    [projects, dailyReports],
  );
  const warrantyMonths = resolveWarrantyMonths(settings);
  const walks = useMemo(
    () => getUpcomingWarrantyWalks(projects, warrantyMonths),
    [projects, warrantyMonths],
  );

  const counts: Record<AttentionView, number> = {
    needs: items.length,
    bill: ready.rows.length,
    logs: logRows.length,
    warranty: walks.length,
  };

  const needsColumns = useMemo<DataTableColumn<AttentionItem>[]>(() => [
    {
      key: 'severity',
      label: 'Severity',
      width: 104,
      sortValue: (i) => SEVERITY_RANK[i.severity],
      render: (i) => (
        <View style={styles.severityCell}>
          <View style={[styles.dot, { backgroundColor: severityInk(i.severity, t) }]} />
          <Text style={styles.cell}>{SEVERITY_LABEL[i.severity]}</Text>
        </View>
      ),
    },
    { key: 'item', label: 'Item', flex: 1, minWidth: 240, sortValue: (i) => itemText(i).toLowerCase(), value: itemText },
    { key: 'job', label: 'Job', width: 200, sortValue: (i) => i.projectName.toLowerCase(), value: (i) => i.projectName },
    { key: 'kind', label: 'Kind', width: 120, sortValue: (i) => KIND_LABEL[i.kind], value: (i) => KIND_LABEL[i.kind] },
  ], [styles, t]);

  const billColumns = useMemo<DataTableColumn<DraftedCORow>[]>(() => [
    { key: 'job', label: 'Job', flex: 1, minWidth: 240, sortValue: (r) => r.projectName.toLowerCase(), value: (r) => r.projectName },
    { key: 'co', label: 'CO #', width: 96, numeric: true, sortValue: (r) => r.coNumber, value: (r) => (r.coNumber > 0 ? `#${r.coNumber}` : null) },
    { key: 'amount', label: 'Amount', width: 128, numeric: true, sortValue: (r) => r.amount, value: (r) => formatMoney(r.amount) },
    { key: 'age', label: 'Age (days)', width: 112, numeric: true, sortValue: (r) => r.ageDays, value: (r) => r.ageDays },
  ], []);

  const logColumns = useMemo<DataTableColumn<DailyLogGapRow>[]>(() => [
    { key: 'job', label: 'Job', flex: 1, minWidth: 240, sortValue: (r) => r.projectName.toLowerCase(), value: (r) => r.projectName },
    {
      key: 'today',
      label: 'Today filed?',
      width: 128,
      sortValue: (r) => (r.c.todayExpected && !r.c.todayFiled ? 0 : 1),
      value: (r) => (r.c.todayExpected ? (r.c.todayFiled ? 'Yes' : 'No') : 'Not a work day'),
    },
    { key: 'missing', label: 'Days missing', width: 128, numeric: true, sortValue: (r) => r.c.missedDays, value: (r) => r.c.missedDays },
  ], []);

  const warrantyColumns = useMemo<DataTableColumn<WarrantyWalkAlert>[]>(() => [
    { key: 'job', label: 'Job', flex: 1, minWidth: 240, sortValue: (a) => a.project.name.toLowerCase(), value: (a) => a.project.name },
    { key: 'walk', label: 'Walk due', width: 136, sortValue: (a) => a.walkDueDate, value: (a) => dayLabel(a.walkDueDate) },
    { key: 'expires', label: 'Warranty expires', width: 152, sortValue: (a) => a.warrantyExpiresAt, value: (a) => dayLabel(a.warrantyExpiresAt) },
    {
      key: 'severity',
      label: 'Severity',
      width: 112,
      sortValue: (a) => (a.severity === 'urgent' ? 0 : a.severity === 'soon' ? 1 : 2),
      value: (a) => (a.severity === 'urgent' ? 'Urgent' : a.severity === 'soon' ? 'Soon' : 'Upcoming'),
    },
  ], []);

  /** The phone card (and every-route jest): one tappable line per record. */
  const card = (key: string, title: string, meta: string, href: Href) => (
    <TouchableOpacity
      key={key}
      style={styles.card}
      onPress={() => router.push(href)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${meta}`}
    >
      <View style={styles.cardText}>
        <Text style={styles.cardTitle} numberOfLines={2}>{title}</Text>
        <Text style={styles.cardMeta} numberOfLines={1}>{meta}</Text>
      </View>
      <ChevronRight size={16} color={t.textMuted} strokeWidth={1.75} />
    </TouchableOpacity>
  );

  const emptyLine = (text: string) => (
    <View style={styles.empty} testID={`attention-${view}-empty`}>
      <Text style={styles.emptySubtitle}>{text}</Text>
    </View>
  );

  let body: React.ReactNode;
  if (view === 'needs') {
    body = items.length === 0 ? (
      sourceFailed ? (
        <View style={styles.empty} testID="attention-unreachable">
          <CloudOff size={22} color={t.warningLabel} strokeWidth={1.8} />
          <Text style={[styles.emptyTitle, { color: t.warningLabel }]}>{UNREACHABLE_LINE}</Text>
          <Text style={styles.emptySubtitle}>Nothing cached needs attention; the live read failed.</Text>
        </View>
      ) : outsideTheScan > 0 ? (
        <TouchableOpacity
          style={styles.empty}
          onPress={() => router.push('/waiting-on')}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Open Waiting On"
          testID="attention-partial-clear"
        >
          <MessageSquareWarning size={22} color={t.warningLabel} strokeWidth={1.8} />
          <Text style={[styles.emptyTitle, { color: t.warningLabel }]}>
            {outsideTheScan === 1 ? '1 reply is overdue' : `${outsideTheScan} replies are overdue`}
          </Text>
          <Text style={styles.emptySubtitle}>
            Schedules, invoices, permits and certs are clear. RFIs and submittals are not — open Waiting On.
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.empty} testID="attention-all-clear">
          <CheckCircle2 size={22} color={t.success} strokeWidth={1.8} />
          <Text style={styles.emptyTitle}>All caught up</Text>
          <Text style={styles.emptySubtitle}>Nothing overdue on schedules, invoices, permits or certs.</Text>
        </View>
      )
    ) : (
      <>
        {sourceFailed ? (
          <View style={styles.unreachableRow} testID="attention-unreachable">
            <CloudOff size={14} color={t.warningLabel} strokeWidth={2} />
            <Text style={[styles.cardMeta, { color: t.warningLabel }]}>{UNREACHABLE_LINE}</Text>
          </View>
        ) : null}
        <DataTable<AttentionItem>
          tableId="attention"
          columns={needsColumns}
          rows={needsShown}
          rowKey={(i) => i.id}
          getRowHref={itemHref}
          defaultSort={{ key: 'severity', dir: 'asc' }}
          searchText={(i) => `${i.message} ${i.projectName}`}
          searchPlaceholder="Search items"
          filterChips={
            <SegmentedControl<SeverityFilter>
              options={[
                { value: 'all', label: 'All', count: items.length },
                { value: 'critical', label: 'Critical', count: items.filter((i) => i.severity === 'critical').length },
                { value: 'high', label: 'High', count: items.filter((i) => i.severity === 'high').length },
              ]}
              value={severity}
              onChange={setSeverity}
              variant="pill"
              accessibilityLabel="Filter by severity"
              testID="attention-severity"
            />
          }
          emptyState={<Text style={styles.emptySubtitle}>Nothing at this severity.</Text>}
          renderCard={(i) => card(i.id, itemText(i), `${i.projectName} · ${SEVERITY_LABEL[i.severity]} · ${KIND_LABEL[i.kind]}`, itemHref(i))}
          testID="attention-table"
        />
      </>
    );
  } else if (view === 'bill') {
    body = ready.rows.length === 0 ? emptyLine('No change orders are drafted and waiting to be sent.') : (
      <DataTable<DraftedCORow>
        tableId="attention-bill"
        columns={billColumns}
        rows={ready.rows}
        rowKey={(r) => r.id}
        getRowHref={(r) => routeHref('/change-order', { projectId: r.projectId, coId: r.id })}
        defaultSort={{ key: 'amount', dir: 'desc' }}
        searchText={(r) => r.projectName}
        searchPlaceholder="Search jobs"
        renderCard={(r) => card(r.id, `${r.projectName} · CO #${r.coNumber}`, `${formatMoney(r.amount)} · ${r.ageDays} ${r.ageDays === 1 ? 'day' : 'days'} old`,
          routeHref('/change-order', { projectId: r.projectId, coId: r.id }))}
        testID="attention-bill-table"
      />
    );
  } else if (view === 'logs') {
    body = logRows.length === 0 ? emptyLine('No active job owes a daily log, and none has a gap in the last 30 days.') : (
      <DataTable<DailyLogGapRow>
        tableId="attention-logs"
        columns={logColumns}
        rows={logRows}
        rowKey={(r) => r.projectId}
        getRowHref={(r) => routeHref('/daily-report', cleanParams(dailyLogGapTarget(r)))}
        searchText={(r) => r.projectName}
        searchPlaceholder="Search jobs"
        renderCard={(r) => card(r.projectId, dailyLogGapLine(r), `${r.c.filedDays} of ${r.c.closedExpectedDays} working days logged`,
          routeHref('/daily-report', cleanParams(dailyLogGapTarget(r))))}
        testID="attention-logs-table"
      />
    );
  } else {
    body = walks.length === 0 ? emptyLine('No warranty walk is due in the next three months.') : (
      <DataTable<WarrantyWalkAlert>
        tableId="attention-warranty"
        columns={warrantyColumns}
        rows={walks}
        rowKey={(a) => a.project.id}
        getRowHref={(a) => routeHref('/warranty-walk', { projectId: a.project.id })}
        defaultSort={{ key: 'walk', dir: 'asc' }}
        searchText={(a) => a.project.name}
        searchPlaceholder="Search jobs"
        renderCard={(a) => card(a.project.id, `${a.project.name} · ${a.warrantyMonthsAssumed ? 'Warranty walk' : warrantyWalkTitle(a.warrantyMonths)}`,
          `Walk due ${dayLabel(a.walkDueDate)} · expires ${dayLabel(a.warrantyExpiresAt)}`,
          routeHref('/warranty-walk', { projectId: a.project.id }))}
        testID="attention-warranty-table"
      />
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="attention-screen">
      <Stack.Screen options={{ title: 'Needs attention' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
        keyboardShouldPersistTaps="handled"
      >
        {router.canGoBack() ? (
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="attention-back"
          >
            <ChevronLeft size={18} color={t.accentLabel} strokeWidth={2} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        ) : null}
        <PageHeader title="Needs attention" hideSearch />
        <View style={styles.switchRow}>
          <SegmentedControl<AttentionView>
            options={(['needs', 'bill', 'logs', 'warranty'] as AttentionView[]).map((v) => ({
              value: v,
              label: VIEW_LABEL[v],
              count: counts[v],
              testID: `attention-view-${v}`,
            }))}
            value={view}
            onChange={(next) => router.setParams({ view: next })}
            variant="pill"
            accessibilityLabel="Which list"
            testID="attention-views"
          />
        </View>
        <View style={styles.body}>{body}</View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.bg },
  content: { paddingBottom: 24 },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 2,
    paddingHorizontal: 12,
    paddingTop: 8,
    minHeight: 32,
  },
  backText: { ...Type.footnoteEmphasized, color: t.accentLabel },
  switchRow: { paddingHorizontal: 16, marginBottom: 12, alignItems: 'flex-start' },
  body: { paddingHorizontal: 16, gap: 8 },
  severityCell: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: Tokens.radius.full },
  cell: { ...Type.footnote, color: t.text },
  card: {
    ...cardSurface(t, { radius: 'panel', pad: 'none' }),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  cardText: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { ...Type.subhead, color: t.text },
  cardMeta: { ...Type.caption1, color: t.textSecondary },
  unreachableRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  empty: {
    ...cardSurface(t, { radius: 'panel', pad: 'none' }),
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { ...Type.bodyCompact, fontWeight: '600', color: t.text },
  emptySubtitle: { ...Type.caption1, color: t.textSecondary, textAlign: 'center' },
});
