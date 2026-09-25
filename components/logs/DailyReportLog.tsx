// components/logs/DailyReportLog.tsx — every daily report on a job, the open
// one read beside it. DESKTOP WEB ONLY (wave 6c, lane H).
//
// WHY. On the founder's 1512 px MacBook /daily-report opened a brand-new
// report for today every time: 2.4 screens of 1,022 px inputs and no list of
// what had already been filed, so a PM reviewing a week of dailies left and
// came back once per day. app/daily-report.tsx now renders this for a bare
// `?projectId=` on desktop web (utils/dailyReportLog.dfrScreenMode); anything
// that names a report or a day — reportId, date, fieldIssue, new=1 — still
// opens the editor, and the phone never sees this file.
//
// Built from the wave-6b primitives: SplitView (list | record, the record in
// the URL as ?rec=), DataTable (sort, search, j/k/Enter; SplitView's Esc) and
// ToolbarActions. Nothing here writes: Edit / Open, the change-order handoff
// and the T&M ticket all go to the screens that already own those writes.

import React, { useEffect, useMemo, useRef } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ClipboardList, FilePlus2, FileSignature, Pencil } from 'lucide-react-native';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { SplitView, useSplitRecord } from '@/components/desktop/SplitView';
import { DataTable, type DataTableColumn } from '@/components/desktop/DataTable';
import { ToolbarActions, type ToolbarAction } from '@/components/desktop/ToolbarActions';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { formatCalendarDay, todayCalendarDay } from '@/utils/calendarDate';
import { defaultDfrSelection, dfrDayKey, dfrLogRow, type DfrLogRow } from '@/utils/dailyReportLog';
import type { DailyFieldReport } from '@/types';

export interface DailyReportLogProps {
  projectId: string;
  /** Who filed a report, as the editor says it (daily-report's dfrFiledBy
   *  `.document`) — null when the row carries no author (the table shows —). */
  filedBy: (r: DailyFieldReport) => string | null;
}

type Row = { report: DailyFieldReport; row: DfrLogRow; filedBy: string | null; day: string | null };

const NOT_RECORDED = '—';

function shortDay(day: string | null): string {
  return day ? formatCalendarDay(day, { weekday: 'short', month: 'short', day: 'numeric' }) : NOT_RECORDED;
}
function longDay(day: string | null): string {
  return day ? formatCalendarDay(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'Date not recorded';
}
const fmtHours = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(1));

export function DailyReportLog({ projectId, filedBy }: DailyReportLogProps) {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { getProject, getDailyReportsForProject, dailyReportsLoaded } = useProjects();
  const project = getProject(projectId);
  const rec = useSplitRecord({ param: 'rec' });

  const rows: Row[] = useMemo(
    () => getDailyReportsForProject(projectId).map((report) => ({
      report,
      row: dfrLogRow(report),
      filedBy: filedBy(report),
      day: dfrDayKey(report.date),
    })),
    [getDailyReportsForProject, projectId, filedBy],
  );

  // Open today's report (or the latest) once, when the list first lands with
  // nothing open. A ref, not a dependency dance: closing the record with Esc
  // must not reopen it.
  const defaulted = useRef(false);
  useEffect(() => {
    if (defaulted.current || !dailyReportsLoaded) return;
    defaulted.current = true;
    if (rec.openId) return;
    const id = defaultDfrSelection(rows.map((r) => r.report), todayCalendarDay());
    if (id) rec.open(id);
  }, [dailyReportsLoaded, rows, rec]);

  const newReport = () => router.push({ pathname: '/daily-report', params: { projectId, new: '1' } });

  const columns: DataTableColumn<Row>[] = useMemo(() => [
    { key: 'date', label: 'Date', width: 120, sortValue: (r) => r.day ?? r.report.date, value: (r) => shortDay(r.day) },
    { key: 'filedBy', label: 'Filed by', flex: 1, hideBelow: 520, sortValue: (r) => r.filedBy, value: (r) => r.filedBy },
    // No crew recorded is unknown, not zero: DataTable shows '—' for null.
    { key: 'crew', label: 'Crew', numeric: true, width: 72, sortValue: (r) => r.row.crew, value: (r) => (r.row.crewRecorded ? r.row.crew : null) },
    { key: 'hours', label: 'Hours', numeric: true, width: 80, sortValue: (r) => r.row.hours, value: (r) => (r.row.crewRecorded ? fmtHours(r.row.hours) : null) },
    { key: 'weather', label: 'Weather', width: 160, hideBelow: 640, value: (r) => r.row.weather },
    { key: 'issue', label: 'Issue', width: 88, sortValue: (r) => r.row.issue, value: (r) => r.row.issue },
    { key: 'photos', label: 'Photos', numeric: true, width: 72, hideBelow: 560, sortValue: (r) => r.row.photos, value: (r) => r.row.photos },
    { key: 'status', label: 'Status', width: 88, sortValue: (r) => r.row.status, value: (r) => (r.row.status === 'sent' ? 'Sent' : 'Draft') },
  ], []);

  const open = rows.find((r) => r.report.id === rec.openId) ?? null;

  const list = (
    <DataTable<Row>
      tableId="dfr-log"
      testID="dfr-log-table"
      rows={rows}
      columns={columns}
      rowKey={(r) => r.report.id}
      activeKey={rec.openId}
      onRowOpen={(r) => rec.open(r.report.id)}
      defaultSort={{ key: 'date', dir: 'desc' }}
      searchText={(r) => [shortDay(r.day), r.report.workPerformed, r.report.issuesAndDelays, r.filedBy ?? ''].join(' ')}
      searchPlaceholder="Search reports"
      // Required by the type; never drawn — this component is desktop-only.
      renderCard={(r) => <Text style={styles.cardLine}>{shortDay(r.day)}</Text>}
      emptyState={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No daily reports on this job yet.</Text>
          <Button label="New report" onPress={newReport} size="sm" testID="dfr-log-empty-new" />
        </View>
      }
    />
  );

  return (
    <View style={styles.outer} testID="dfr-log">
      {/* The route's stack header also says "Daily Report" (app/_layout.tsx);
          this page draws its own title, so the header would stack a second
          one above it. The editor hides it the same way. Desktop web only. */}
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.inner}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title} accessibilityRole="header">Daily reports</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{project?.name ?? NOT_RECORDED}</Text>
          </View>
          <ToolbarActions
            testID="dfr-log-actions"
            actions={[{ key: 'new', label: 'New report', icon: FilePlus2, primary: true, onPress: newReport, testID: 'dfr-log-new' }]}
          />
        </View>
        <SplitView
          splitId="dfr-log"
          testID="dfr-log-split"
          openId={rec.openId}
          onClose={rec.close}
          list={list}
          detail={open ? <DfrRecord row={open} projectId={projectId} /> : null}
          emptyDetail={<Text style={styles.emptyText}>Pick a report on the left</Text>}
        />
      </View>
    </View>
  );
}

/** The open report, read-only. Every empty field says so; nothing is guessed. */
function DfrRecord({ row, projectId }: { row: Row; projectId: string }) {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { report: r, row: sum } = row;
  const issues = (r.issuesAndDelays ?? '').trim();
  const work = (r.workPerformed ?? '').trim();
  const sent = r.status === 'sent';
  const temp = (r.weather?.temperature ?? '').trim();
  const cond = (r.weather?.conditions ?? '').trim();
  const wind = (r.weather?.wind ?? '').trim();
  const weatherParts = [temp, cond, wind ? `wind ${wind}` : ''].filter(Boolean);
  const materials = (r.materialsDelivered ?? []).map((m) => m.trim()).filter(Boolean);
  const manpower = r.manpower ?? [];
  const photos = r.photos ?? [];

  const actions: ToolbarAction[] = [
    {
      key: 'edit',
      label: sent ? 'Open' : 'Edit',
      icon: Pencil,
      primary: true,
      onPress: () => router.push({ pathname: '/daily-report', params: { projectId, reportId: r.id } }),
      testID: 'dfr-log-edit',
    },
    {
      key: 'co',
      label: 'Create change order from issues',
      icon: ClipboardList,
      disabled: !issues,
      disabledReason: issues ? null : 'No issues or delays on this report',
      onPress: () => router.push({ pathname: '/change-order', params: { projectId, prefillDescription: issues } }),
      testID: 'dfr-log-co',
    },
    {
      key: 'tm',
      label: 'Write T&M ticket',
      icon: FileSignature,
      onPress: () => router.push({
        pathname: '/field-ticket',
        params: { projectId, start: '1', sourceDailyReportId: r.id, ...(issues ? { prefillWork: issues } : null) },
      }),
      testID: 'dfr-log-tm',
    },
  ];

  return (
    <ScrollView style={styles.record} contentContainerStyle={styles.recordContent} testID="dfr-log-record">
      <View style={styles.recordHead}>
        <Text style={styles.recordTitle}>{longDay(row.day)}</Text>
        <StatusPill label={sent ? 'Sent' : 'Draft'} tone={sent ? 'success' : 'neutral'} size="compact" />
      </View>
      <Text style={styles.meta}>{row.filedBy ? `Filed by ${row.filedBy}` : 'Author not recorded'}</Text>
      <ToolbarActions actions={actions} testID="dfr-log-record-actions" />

      <Text style={styles.section}>Weather</Text>
      <Text style={styles.body}>
        {weatherParts.length ? weatherParts.join(' · ') : 'Weather not recorded'}
        {weatherParts.length && r.weather?.isManual ? ' (entered by hand)' : ''}
      </Text>

      <Text style={styles.section}>Crew</Text>
      {manpower.length === 0 ? (
        <Text style={styles.muted}>No crew recorded</Text>
      ) : (
        <View style={styles.crewTable}>
          <View style={[styles.crewRow, styles.crewHead]}>
            <Text style={[styles.crewCell, styles.crewHeadText]}>Trade</Text>
            <Text style={[styles.crewCell, styles.crewHeadText]}>Company</Text>
            <Text style={[styles.crewNum, styles.crewHeadText]}>Headcount</Text>
            <Text style={[styles.crewNum, styles.crewHeadText]}>Hours</Text>
          </View>
          {manpower.map((m) => (
            <View key={m.id} style={styles.crewRow}>
              <Text style={styles.crewCell} numberOfLines={1}>{m.trade?.trim() || NOT_RECORDED}</Text>
              <Text style={styles.crewCell} numberOfLines={1}>{m.company?.trim() || NOT_RECORDED}</Text>
              <Text style={styles.crewNum}>{m.headcount}</Text>
              <Text style={styles.crewNum}>{fmtHours(m.hoursWorked)}</Text>
            </View>
          ))}
        </View>
      )}
      {manpower.length > 0 ? (
        <Text style={styles.muted}>{sum.crew} on site · {fmtHours(sum.hours)} man-hours</Text>
      ) : null}

      <Text style={styles.section}>Work performed</Text>
      <Text style={work ? styles.body : styles.muted}>{work || 'Not recorded'}</Text>

      <Text style={styles.section}>Materials delivered</Text>
      <Text style={materials.length ? styles.body : styles.muted}>{materials.length ? materials.join('\n') : 'None recorded'}</Text>

      <Text style={styles.section}>Issues &amp; delays</Text>
      <Text style={issues ? styles.body : styles.muted}>{issues || 'None recorded'}</Text>

      {r.incident?.hasIncident ? (
        <>
          <Text style={styles.section}>Incident</Text>
          <Text style={styles.body}>
            {[r.incident.severity ? `Severity: ${r.incident.severity}` : null, (r.incident.description ?? '').trim() || 'No description recorded']
              .filter(Boolean).join('\n')}
          </Text>
        </>
      ) : null}

      <Text style={styles.section}>Photos</Text>
      {photos.length === 0 ? (
        <Text style={styles.muted}>No photos</Text>
      ) : (
        <View style={styles.photos}>
          {photos.map((p) => (
            <Image key={p.id} source={{ uri: p.uri }} style={styles.photo} accessibilityLabel="Report photo" />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const PHOTO = 120;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  outer: { flex: 1, backgroundColor: t.bg },
  inner: { flex: 1, width: '100%', maxWidth: Layout.page.dashboard, alignSelf: 'center', paddingHorizontal: Layout.gutter, paddingTop: Layout.gutter, gap: Layout.groupGap },
  header: { flexDirection: 'row', alignItems: 'center', gap: Layout.groupGap },
  headerText: { flex: 1, gap: 2 },
  title: { ...Type.serifHeadline, color: t.text },
  subtitle: { ...Type.footnote, color: t.textSecondary },
  cardLine: { ...Type.bodyCompact, color: t.text },
  empty: { alignItems: 'flex-start', gap: Layout.rowGap, padding: Layout.cardPad },
  emptyText: { ...Type.bodyCompact, color: t.textSecondary },
  record: { flex: 1 },
  recordContent: { padding: Layout.cardPad, gap: Layout.rowGap, maxWidth: Layout.page.form },
  recordHead: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  recordTitle: { ...Type.title3, color: t.text },
  meta: { ...Type.footnote, color: t.textSecondary },
  section: { ...Type.footnoteEmphasized, color: t.textSecondary, marginTop: Layout.groupGap, textTransform: 'uppercase', letterSpacing: 0.4 },
  body: { ...Type.bodyCompact, color: t.text, maxWidth: Layout.prose },
  muted: { ...Type.bodyCompact, color: t.textMuted },
  crewTable: { borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md, overflow: 'hidden' },
  crewRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight: Layout.control.row, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line, gap: 8 },
  crewHead: { minHeight: Layout.control.tableHeader, backgroundColor: t.surfaceAlt },
  crewHeadText: { ...Type.caption1, color: t.textSecondary },
  crewCell: { flex: 1, ...Type.bodyCompact, color: t.text },
  crewNum: { width: 88, textAlign: 'right', ...Type.bodyCompact, color: t.text, fontVariant: ['tabular-nums'] },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: Layout.rowGap },
  photo: { width: PHOTO, height: PHOTO, borderRadius: Tokens.radius.md, backgroundColor: t.surfaceAlt },
});

export default DailyReportLog;
