// Weekly Snapshot — a "what happened this week" pulse-check per project.
//
// Premium pulse-check view that the file-org audit pitched as the
// billionaire-mindset move: instead of the user hunting through 4
// collapsible groups in Project Detail to answer "what changed this
// week?", this is a single scroll that shows weather highs/lows,
// total manpower hours, RFIs opened/closed, invoices unpaid, photos
// taken, change orders filed.
//
// Data is derived from the existing ProjectContext (no new persisted
// state). Week window defaults to "this week" (Mon-Sun, locale-style)
// and a chip row lets you flip between This Week / Last Week / Last 30d.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Cloud, Users, ClipboardList, FileText, Receipt, Camera, Repeat, AlertTriangle, CheckCircle2, TrendingDown, TrendingUp,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import FilterChipRow, { type FilterChip } from '@/components/FilterChipRow';
import BlueprintReveal from '@/components/animations/BlueprintReveal';
import TapeRollNumber from '@/components/animations/TapeRollNumber';
import ConcretePour from '@/components/animations/ConcretePour';
import { formatMoney } from '@/utils/formatters';

type WindowKey = 'thisWeek' | 'lastWeek' | 'last30';

interface WindowRange {
  start: number;
  end: number;
  label: string;
}

function startOfWeek(d: Date): Date {
  const day = d.getDay() === 0 ? 7 : d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function endOfWeek(d: Date): Date {
  const monday = startOfWeek(d);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return sunday;
}

function getWindow(key: WindowKey): WindowRange {
  const now = new Date();
  if (key === 'thisWeek') {
    const start = startOfWeek(now);
    const end = endOfWeek(now);
    return { start: start.getTime(), end: end.getTime(), label: `Week of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` };
  }
  if (key === 'lastWeek') {
    const lastWeekRef = new Date(now);
    lastWeekRef.setDate(now.getDate() - 7);
    const start = startOfWeek(lastWeekRef);
    const end = endOfWeek(lastWeekRef);
    return { start: start.getTime(), end: end.getTime(), label: `Week of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` };
  }
  // last 30 days
  const end = new Date(now);
  const start = new Date(now);
  start.setDate(now.getDate() - 30);
  start.setHours(0, 0, 0, 0);
  return { start: start.getTime(), end: end.getTime(), label: 'Last 30 days' };
}

export default function WeeklySnapshotScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const {
    getProject,
    getDailyReportsForProject,
    getRFIsForProject,
    getInvoicesForProject,
    getPhotosForProject,
    getChangeOrdersForProject,
    getPunchItemsForProject,
  } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const [windowKey, setWindowKey] = useState<WindowKey>('thisWeek');
  const range = useMemo(() => getWindow(windowKey), [windowKey]);

  const dfrs = useMemo(() => getDailyReportsForProject(projectId ?? ''), [projectId, getDailyReportsForProject]);
  const rfis = useMemo(() => getRFIsForProject(projectId ?? ''), [projectId, getRFIsForProject]);
  const invoices = useMemo(() => getInvoicesForProject(projectId ?? ''), [projectId, getInvoicesForProject]);
  const photos = useMemo(() => getPhotosForProject(projectId ?? ''), [projectId, getPhotosForProject]);
  const changeOrders = useMemo(() => getChangeOrdersForProject(projectId ?? ''), [projectId, getChangeOrdersForProject]);
  const punch = useMemo(() => getPunchItemsForProject(projectId ?? ''), [projectId, getPunchItemsForProject]);

  // Filter each collection to the current window, deriving the metrics
  // we'll surface in the cards.
  const inRange = (iso?: string) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t >= range.start && t <= range.end;
  };

  const weekDfrs = useMemo(() => dfrs.filter(d => inRange(d.date)), [dfrs, range]);

  const weatherStats = useMemo(() => {
    const temps: number[] = [];
    const conditions = new Map<string, number>();
    for (const d of weekDfrs) {
      const tStr = d.weather?.temperature?.toString().replace(/[^0-9.\-]/g, '');
      const t = tStr ? parseFloat(tStr) : NaN;
      if (Number.isFinite(t)) temps.push(t);
      const c = (d.weather?.conditions || '').trim();
      if (c) conditions.set(c, (conditions.get(c) ?? 0) + 1);
    }
    const high = temps.length ? Math.max(...temps) : null;
    const low = temps.length ? Math.min(...temps) : null;
    const dominant = Array.from(conditions.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { high, low, dominant };
  }, [weekDfrs]);

  const manpowerHours = useMemo(() => {
    let totalWorkers = 0;
    let totalHours = 0;
    for (const d of weekDfrs) {
      for (const m of d.manpower) {
        totalWorkers += m.headcount;
        totalHours += m.headcount * m.hoursWorked;
      }
    }
    return { totalWorkers, totalHours, days: weekDfrs.length };
  }, [weekDfrs]);

  const rfiStats = useMemo(() => {
    const opened = rfis.filter(r => inRange(r.dateSubmitted ?? r.createdAt)).length;
    const closed = rfis.filter(r =>
      (r.status === 'closed' || r.status === 'answered') && inRange(r.dateResponded ?? r.updatedAt)
    ).length;
    const stillOpen = rfis.filter(r => r.status === 'open').length;
    const overdue = rfis.filter(r => r.status === 'open' && r.dateRequired && new Date(r.dateRequired).getTime() < Date.now()).length;
    return { opened, closed, stillOpen, overdue };
  }, [rfis, range]);

  const invoiceStats = useMemo(() => {
    const issuedThisWindow = invoices.filter(i => inRange(i.issueDate));
    const totalIssued = issuedThisWindow.reduce((s, i) => s + (i.totalDue ?? 0), 0);
    const totalUnpaid = invoices.reduce((s, i) => s + Math.max(0, (i.totalDue ?? 0) - (i.amountPaid ?? 0)), 0);
    const paidThisWindow = invoices
      .flatMap(i => i.payments ?? [])
      .filter(p => inRange(p.date))
      .reduce((s, p) => s + (p.amount ?? 0), 0);
    return { issuedCount: issuedThisWindow.length, totalIssued, totalUnpaid, paidThisWindow };
  }, [invoices, range]);

  const photoCount = useMemo(() => photos.filter(p => inRange(p.timestamp)).length, [photos, range]);
  const coCount = useMemo(() => changeOrders.filter(c => inRange(c.createdAt)).length, [changeOrders, range]);
  const punchClosedCount = useMemo(() =>
    punch.filter(p => p.status === 'closed' && inRange(p.closedAt ?? p.updatedAt)).length,
    [punch, range],
  );
  const punchOpenedCount = useMemo(() => punch.filter(p => inRange(p.createdAt)).length, [punch, range]);

  if (!project) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 80 }]}>
        <Text style={styles.notFound}>Project not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><Text style={styles.backBtnText}>Go back</Text></TouchableOpacity>
      </View>
    );
  }

  const chips: FilterChip<WindowKey>[] = [
    { value: 'thisWeek', label: 'This Week' },
    { value: 'lastWeek', label: 'Last Week' },
    { value: 'last30', label: 'Last 30d' },
  ];

  // Burn % for the concrete-pour visual: how much of the budget has been
  // billed-out so far, capped at 1.0 for display purposes.
  const totalBilled = invoices.reduce((s, i) => s + (i.totalDue ?? 0), 0);
  const budgetCap = project.estimate?.grandTotal ?? totalBilled;
  const burnPct = budgetCap > 0 ? Math.min(1, totalBilled / budgetCap) : 0;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'This Week',
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBack} testID="snapshot-back">
            <ChevronLeft size={22} color={Colors.primary} />
            <Text style={styles.headerBackText}>Back</Text>
          </TouchableOpacity>
        ),
      }} />
      {/*
        The Stack.Screen above already renders a native nav header that
        respects insets.top, so the previous `insets.top + 56` here was
        adding a SECOND chunk of dead space (~110px on iOS) above the
        hero card. Now we just add a small gap below the native header.
      */}
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: 16, paddingBottom: insets.bottom + 30 }]}>
        <BlueprintReveal>
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>{range.label}</Text>
            <Text style={styles.heroProject} numberOfLines={1}>{project.name}</Text>
            <FilterChipRow chips={chips} value={windowKey} onChange={setWindowKey} noPadding testID="window-chips" />
          </View>
        </BlueprintReveal>

        {/* Weather + Manpower row */}
        <View style={styles.row}>
          <View style={[styles.card, styles.cardHalf]}>
            <View style={styles.cardHeader}>
              <Cloud size={16} color={Colors.info} />
              <Text style={styles.cardLabel}>Weather</Text>
            </View>
            {weatherStats.high !== null ? (
              <>
                <Text style={styles.cardBigValue}>{Math.round(weatherStats.high)}°/{Math.round(weatherStats.low ?? weatherStats.high)}°</Text>
                <Text style={styles.cardSub}>{weatherStats.dominant || '—'}</Text>
              </>
            ) : (
              <Text style={styles.cardEmpty}>No DFR weather logged</Text>
            )}
          </View>
          <View style={[styles.card, styles.cardHalf]}>
            <View style={styles.cardHeader}>
              <Users size={16} color={Colors.primary} />
              <Text style={styles.cardLabel}>Manpower</Text>
            </View>
            <TapeRollNumber value={manpowerHours.totalHours} formatter={n => `${Math.round(n).toLocaleString()}`} style={styles.cardBigValue} />
            <Text style={styles.cardSub}>hours · {manpowerHours.days} report{manpowerHours.days === 1 ? '' : 's'}</Text>
          </View>
        </View>

        {/* RFIs + Invoices row */}
        <View style={styles.row}>
          <View style={[styles.card, styles.cardHalf]}>
            <View style={styles.cardHeader}>
              <FileText size={16} color={Colors.warning} />
              <Text style={styles.cardLabel}>RFIs</Text>
            </View>
            <Text style={styles.cardBigValue}>{rfiStats.opened} <Text style={styles.cardArrow}>→</Text> {rfiStats.closed}</Text>
            <Text style={styles.cardSub}>opened · closed</Text>
            {rfiStats.overdue > 0 && (
              <View style={styles.warnPill}>
                <AlertTriangle size={11} color={Colors.error} />
                <Text style={styles.warnPillText}>{rfiStats.overdue} overdue</Text>
              </View>
            )}
          </View>
          <View style={[styles.card, styles.cardHalf]}>
            <View style={styles.cardHeader}>
              <Receipt size={16} color={Colors.success} />
              <Text style={styles.cardLabel}>Invoices</Text>
            </View>
            <TapeRollNumber value={invoiceStats.totalUnpaid} formatter={n => formatMoney(Math.round(n))} style={styles.cardBigValue} />
            <Text style={styles.cardSub}>unpaid balance · all-time</Text>
            {invoiceStats.paidThisWindow > 0 && (
              <View style={styles.successPill}>
                <CheckCircle2 size={11} color={Colors.success} />
                <Text style={styles.successPillText}>{formatMoney(Math.round(invoiceStats.paidThisWindow))} paid this window</Text>
              </View>
            )}
          </View>
        </View>

        {/* Photos + Change Orders + Punch row */}
        <View style={styles.row}>
          <View style={[styles.card, styles.cardThird]}>
            <View style={styles.cardHeader}>
              <Camera size={14} color={Colors.info} />
              <Text style={styles.cardLabel}>Photos</Text>
            </View>
            <TapeRollNumber value={photoCount} formatter={n => `${Math.round(n)}`} style={styles.cardBigValueSmall} />
          </View>
          <View style={[styles.card, styles.cardThird]}>
            <View style={styles.cardHeader}>
              <Repeat size={14} color={Colors.accent} />
              <Text style={styles.cardLabel}>COs</Text>
            </View>
            <TapeRollNumber value={coCount} formatter={n => `${Math.round(n)}`} style={styles.cardBigValueSmall} />
          </View>
          <View style={[styles.card, styles.cardThird]}>
            <View style={styles.cardHeader}>
              <ClipboardList size={14} color={Colors.warning} />
              <Text style={styles.cardLabel}>Punch</Text>
            </View>
            <Text style={styles.cardBigValueSmall}>{punchOpenedCount}<Text style={styles.cardArrow}>/</Text>{punchClosedCount}</Text>
          </View>
        </View>

        {/* Budget burn */}
        {budgetCap > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              {burnPct < 0.85 ? <TrendingUp size={16} color={Colors.success} /> : <TrendingDown size={16} color={Colors.warning} />}
              <Text style={styles.cardLabel}>Budget Burn</Text>
              <Text style={styles.burnPct}>{Math.round(burnPct * 100)}%</Text>
            </View>
            <ConcretePour value={burnPct} height={10} fillColor={burnPct < 0.85 ? Colors.success : Colors.warning} />
            <Text style={styles.cardSub}>
              {formatMoney(Math.round(totalBilled))} billed of {formatMoney(Math.round(budgetCap))}
            </Text>
          </View>
        )}

        {/* Quick actions to the relevant detail tabs */}
        <View style={styles.actionsCard}>
          <Text style={styles.actionsLabel}>Jump to</Text>
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => {
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
                router.replace({ pathname: '/project-detail' as any, params: { id: project.id } });
              }}
              testID="snapshot-back-to-project"
            >
              <Text style={styles.actionBtnText}>Project Detail</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => router.push({ pathname: '/daily-report' as any, params: { projectId: project.id } })}
              testID="snapshot-new-dfr"
            >
              <Text style={styles.actionBtnText}>+ New DFR</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  notFound: { fontSize: 16, color: Colors.textSecondary, marginBottom: 16 },
  backBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: Colors.primary, borderRadius: 10 },
  backBtnText: { color: '#fff', fontWeight: '600' },
  headerBack: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 6, paddingLeft: 4, minWidth: 72 },
  headerBackText: { fontSize: 16, fontWeight: '500', color: Colors.primary },
  heroCard: { backgroundColor: Colors.primary, borderRadius: 18, padding: 18, marginTop: 4, gap: 10 },
  heroLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.65)', letterSpacing: 0.6, textTransform: 'uppercase' },
  heroProject: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: -0.5, marginTop: -4 },
  row: { flexDirection: 'row', gap: 10 },
  card: { backgroundColor: Colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.cardBorder, gap: 4 },
  cardHalf: { flex: 1 },
  cardThird: { flex: 1, paddingVertical: 12, paddingHorizontal: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase' },
  cardBigValue: { fontSize: 22, fontWeight: '800', color: Colors.text, letterSpacing: -0.5, marginTop: 4 },
  cardBigValueSmall: { fontSize: 18, fontWeight: '800', color: Colors.text, marginTop: 4 },
  cardSub: { fontSize: 11, color: Colors.textMuted, fontWeight: '500' },
  cardEmpty: { fontSize: 13, color: Colors.textMuted, fontStyle: 'italic', marginTop: 4 },
  cardArrow: { color: Colors.textMuted, fontWeight: '500' },
  warnPill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: Colors.errorLight, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, marginTop: 4 },
  warnPillText: { fontSize: 10, fontWeight: '700', color: Colors.error },
  successPill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: Colors.successLight, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, marginTop: 4 },
  successPillText: { fontSize: 10, fontWeight: '700', color: Colors.success },
  burnPct: { marginLeft: 'auto', fontSize: 13, fontWeight: '800', color: Colors.text },
  actionsCard: { backgroundColor: Colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.cardBorder },
  actionsLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  actionsRow: { flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.fillSecondary, alignItems: 'center' },
  actionBtnText: { fontSize: 14, fontWeight: '600', color: Colors.text },
});
