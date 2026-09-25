// components/logs/RfiLog.tsx — every RFI on a job, the open one beside it
// (wave 6c, lane G). DESKTOP WEB ONLY: app/rfi.tsx renders this only when
// utils/logs/logRoutes.logRouteMode says 'log' or 'split'.
//
// Nothing here writes. The record pane is the RFI screen's own form
// (RFIForm), which saves through the context and the offline queue as always.

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { MessageSquareText } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjects } from '@/contexts/ProjectContext';
import { DataTable, type DataTableColumn } from '@/components/desktop/DataTable';
import { routeHref } from '@/components/desktop/RowLink';
import FilterChipRow from '@/components/FilterChipRow';
import EmptyState from '@/components/EmptyState';
import { StatusPill, type StatusTone } from '@/components/ui/StatusPill';
import { LogShell } from '@/components/logs/LogShell';
import { LogCard } from '@/components/logs/LogCard';
import { RecordContextStrip } from '@/components/logs/RecordContextStrip';
import { rowsToCsv } from '@/utils/dataTable';
import { deliverTextFile } from '@/utils/platformFile';
import { logCsvFileName, logDayKey, logDayLabel, logNumberLabel } from '@/utils/logs/logRoutes';
import {
  RFI_LOG_FILTERS, defaultLogFilter, rfiBallLabel, rfiDaysOpen, rfiLogChipCounts, rfiLogFilter,
  rfiOverdueDays, rfiPriorityLabel, rfiSearchText, rfiStatusLabel, type RfiLogFilter,
} from '@/utils/logs/rfiLogRows';
import type { RFI } from '@/types';

export interface RfiLogProps {
  projectId: string;
  /** The open record (?rfiId) — null/undefined in plain log mode. */
  openId?: string | null;
  /** The editor for the open record, or undefined in plain log mode. */
  detail?: React.ReactNode;
}

function rfiTone(r: RFI, now: Date): StatusTone {
  if (r.status === 'open') return rfiOverdueDays(r, now) > 0 ? 'error' : 'warning';
  if (r.status === 'answered') return 'success';
  return 'neutral';
}

export function RfiLog({ projectId, openId, detail }: RfiLogProps) {
  const router = useRouter();
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { getRFIsForProject, getProject } = useProjects();
  const project = getProject(projectId);
  const all = useMemo(() => getRFIsForProject(projectId), [getRFIsForProject, projectId]);
  const now = useMemo(() => new Date(), [all]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => rfiLogChipCounts(all, now), [all, now]);
  const [picked, setPicked] = useState<RfiLogFilter | null>(null);
  const filter: RfiLogFilter = picked ?? defaultLogFilter<RfiLogFilter>('open', counts, all.length);
  const rows = useMemo(() => all.filter((r) => rfiLogFilter(r, filter, now)), [all, filter, now]);

  const columns: DataTableColumn<RFI>[] = useMemo(() => [
    { key: 'number', label: '#', width: 56, numeric: true, sortValue: (r) => r.number, value: (r) => r.number },
    { key: 'subject', label: 'Subject', flex: 1, minWidth: 200, sortValue: (r) => r.subject, value: (r) => r.subject || null },
    { key: 'ball', label: 'Ball in court', width: 150, hideBelow: 700, sortValue: (r) => rfiBallLabel(r.ballInCourt), value: (r) => rfiBallLabel(r.ballInCourt) },
    { key: 'assigned', label: 'Assigned', width: 150, hideBelow: 900, sortValue: (r) => r.assignedTo, value: (r) => r.assignedTo || null },
    { key: 'due', label: 'Due', width: 96, sortValue: (r) => logDayKey(r.dateRequired), value: (r) => logDayLabel(r.dateRequired, now) },
    {
      key: 'daysOpen', label: 'Days open', width: 84, numeric: true, hideBelow: 700,
      sortValue: (r) => rfiDaysOpen(r, now),
      render: (r) => {
        const d = rfiDaysOpen(r, now);
        const late = rfiOverdueDays(r, now) > 0;
        return <Text style={[styles.num, late && { color: t.dangerLabel }]}>{d === null ? '—' : String(d)}</Text>;
      },
    },
    { key: 'priority', label: 'Priority', width: 88, hideBelow: 800, sortValue: (r) => r.priority, value: (r) => rfiPriorityLabel(r.priority) },
    {
      key: 'status', label: 'Status', width: 104, sortValue: (r) => r.status,
      render: (r) => <StatusPill label={rfiStatusLabel(r.status) ?? '—'} tone={rfiTone(r, now)} size="compact" />,
    },
  ], [now, styles.num, t.dangerLabel]);

  const csvColumns = useMemo(() => [
    { key: 'number', label: 'RFI', csvValue: (r: RFI) => logNumberLabel('RFI', r.number) },
    { key: 'subject', label: 'Subject', csvValue: (r: RFI) => r.subject },
    { key: 'ball', label: 'Ball in court', csvValue: (r: RFI) => rfiBallLabel(r.ballInCourt) },
    { key: 'assigned', label: 'Assigned', csvValue: (r: RFI) => r.assignedTo || null },
    { key: 'due', label: 'Due', csvValue: (r: RFI) => logDayKey(r.dateRequired) },
    { key: 'daysOpen', label: 'Days open', csvValue: (r: RFI) => rfiDaysOpen(r, now) },
    { key: 'priority', label: 'Priority', csvValue: (r: RFI) => rfiPriorityLabel(r.priority) },
    { key: 'status', label: 'Status', csvValue: (r: RFI) => rfiStatusLabel(r.status) },
    { key: 'question', label: 'Question', csvValue: (r: RFI) => r.question },
  ], [now]);

  const csv = useCallback(() => rowsToCsv(csvColumns, rows), [csvColumns, rows]);
  const exportSelected = useCallback((ids: string[]) => {
    const pick = rows.filter((r) => ids.includes(r.id));
    void deliverTextFile(logCsvFileName('rfi', project?.name, new Date()), rowsToCsv(csvColumns, pick), 'text/csv;charset=utf-8');
  }, [rows, csvColumns, project?.name]);

  const newRfi = useCallback(() => router.push(routeHref('/rfi', { projectId, new: '1' })), [router, projectId]);

  const open = openId ? all.find((r) => r.id === openId) ?? null : null;

  const strip = open ? (
    <RecordContextStrip
      testID="rfi-log-strip"
      status={{ label: rfiStatusLabel(open.status) ?? '—', tone: rfiTone(open, now) }}
      facts={[
        { label: 'Ball in court', value: rfiBallLabel(open.ballInCourt) },
        rfiOverdueDays(open, now) > 0
          ? { label: 'Due', value: `${rfiOverdueDays(open, now)} days overdue`, tone: 'danger' as const }
          : { label: 'Due', value: logDayLabel(open.dateRequired, now) },
        { label: 'Days open', value: (() => { const d = rfiDaysOpen(open, now); return d === null ? null : String(d); })() },
        { label: 'Priority', value: rfiPriorityLabel(open.priority) },
      ]}
    />
  ) : null;

  return (
    <LogShell
      kind="rfi"
      projectId={projectId}
      testID="rfi-log"
      detail={detail}
      strip={strip}
      csv={csv}
      renderTable={({ activeKey, onRowOpen, getRowHref }) => (
          <DataTable<RFI>
            tableId="rfi-log"
            testID="rfi-log-table"
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            activeKey={activeKey}
            onRowOpen={(r) => onRowOpen(r.id)}
            getRowHref={(r) => getRowHref(r.id)}
            defaultSort={{ key: 'number', dir: 'desc' }}
            searchText={rfiSearchText}
            searchPlaceholder="Search RFIs"
            selectable
            filterChips={(
              <FilterChipRow<RfiLogFilter>
                noPadding
                testID="rfi-log-chip"
                value={filter}
                onChange={setPicked}
                chips={RFI_LOG_FILTERS.map((f) => ({ value: f.key, label: f.label, count: counts[f.key] }))}
              />
            )}
            bulkActions={[
              { key: 'csv', label: 'Export CSV', run: exportSelected },
              {
                key: 'close',
                label: 'Close',
                run: () => {},
                disabledReason: 'Close each RFI from its record — closing hands the ball to "closed" and logs it, one RFI at a time.',
              },
            ]}
            emptyState={(
              <EmptyState
                icon={<MessageSquareText size={28} color={t.accent} />}
                title={all.length === 0 ? 'No RFIs on this job yet' : 'Nothing under this filter'}
                message={all.length === 0 ? 'Raise one when the drawings leave a question open.' : 'Pick another chip, or All.'}
                actionLabel="New RFI"
                onAction={newRfi}
              />
            )}
            renderCard={(r) => <LogCard title={`${logNumberLabel('RFI', r.number) ?? 'RFI'} · ${r.subject}`} meta={rfiStatusLabel(r.status)} />}
          />
      )}
    />
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  num: { ...Type.bodyCompact, color: t.text, textAlign: 'right', fontVariant: ['tabular-nums'] },
});

export default RfiLog;
