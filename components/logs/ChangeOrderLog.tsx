// components/logs/ChangeOrderLog.tsx — every change order on a job, the open
// one beside it (wave 6c, lane G). DESKTOP WEB ONLY: app/change-order.tsx
// renders this only when utils/logs/logRoutes.logRouteMode says 'log' or
// 'split'.
//
// Nothing here writes; the record pane is the change-order screen's own
// editor. The line grid (Grid | Cards) is wave 6d — the editor keeps its cards.
// Until changeOrdersLoaded the empty table says "Loading change orders…",
// never "No change orders on this job yet" (wave 6d, lane V3).

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { ClipboardList } from 'lucide-react-native';
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
import { logCsvFileName, logDayKey, logDayLabel, logMoney } from '@/utils/logs/logRoutes';
import {
  CO_LOG_FILTERS, coApprovalsLabel, coLogChipCounts, coLogFilter, coLogTotals, coScheduleDays, coSearchText,
  coSignedAmount, coStatusLabel, type CoLogFilter,
} from '@/utils/logs/changeOrderLogRows';
import type { ChangeOrder } from '@/types';

export interface ChangeOrderLogProps {
  projectId: string;
  openId?: string | null;
  detail?: React.ReactNode;
}

function coTone(co: ChangeOrder): StatusTone {
  switch (co.status) {
    case 'approved': return 'success';
    case 'rejected': return 'error';
    case 'submitted':
    case 'under_review':
    case 'revised': return 'warning';
    default: return 'neutral';
  }
}

const daysLabel = (d: number | null): string | null => (d === null ? null : `${d > 0 ? '+' : ''}${d}`);

export function ChangeOrderLog({ projectId, openId, detail }: ChangeOrderLogProps) {
  const router = useRouter();
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { getChangeOrdersForProject, getProject, changeOrdersLoaded } = useProjects();
  const project = getProject(projectId);
  const all = useMemo(() => getChangeOrdersForProject(projectId), [getChangeOrdersForProject, projectId]);
  const now = useMemo(() => new Date(), [all]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nothing on this device and the collection not loaded: no empty copy, no counts.
  const loading = all.length === 0 && !changeOrdersLoaded;

  const counts = useMemo(() => coLogChipCounts(all), [all]);
  // Opens on All: the footer's approved / pending money is the job's, not
  // one chip's slice of it.
  const [filter, setPicked] = useState<CoLogFilter>('all');
  const rows = useMemo(() => all.filter((co) => coLogFilter(co, filter)), [all, filter]);
  const totals = useMemo(() => coLogTotals(rows), [rows]);

  const columns: DataTableColumn<ChangeOrder>[] = useMemo(() => [
    { key: 'number', label: '#', width: 56, numeric: true, sortValue: (co) => co.number, value: (co) => co.number },
    { key: 'description', label: 'Description', flex: 1, minWidth: 200, sortValue: (co) => co.description, value: (co) => co.description || null },
    { key: 'reason', label: 'Reason', width: 140, hideBelow: 1000, sortValue: (co) => co.reason, value: (co) => co.reason || null },
    {
      key: 'amount', label: 'Amount', width: 120, numeric: true, sortValue: coSignedAmount,
      render: (co) => {
        const a = coSignedAmount(co);
        return <Text style={[styles.num, a !== null && a < 0 && { color: t.dangerLabel }]}>{logMoney(a, true) ?? '—'}</Text>;
      },
    },
    { key: 'days', label: 'Sched days', width: 80, numeric: true, hideBelow: 900, sortValue: coScheduleDays, value: (co) => daysLabel(coScheduleDays(co)) },
    { key: 'approvals', label: 'Approvals', width: 96, hideBelow: 800, sortValue: coApprovalsLabel, value: coApprovalsLabel },
    {
      key: 'status', label: 'Status', width: 110, sortValue: (co) => co.status,
      render: (co) => <StatusPill label={coStatusLabel(co.status) ?? '—'} tone={coTone(co)} size="compact" />,
    },
    { key: 'date', label: 'Date', width: 96, hideBelow: 900, sortValue: (co) => logDayKey(co.date), value: (co) => logDayLabel(co.date, now) },
  ], [now, styles.num, t.dangerLabel]);

  const csvColumns = useMemo(() => [
    { key: 'number', label: 'CO', csvValue: (co: ChangeOrder) => co.number },
    { key: 'description', label: 'Description', csvValue: (co: ChangeOrder) => co.description },
    { key: 'reason', label: 'Reason', csvValue: (co: ChangeOrder) => co.reason || null },
    { key: 'amount', label: 'Amount', csvValue: coSignedAmount },
    { key: 'days', label: 'Schedule days', csvValue: coScheduleDays },
    { key: 'approvals', label: 'Approvals', csvValue: coApprovalsLabel },
    { key: 'status', label: 'Status', csvValue: (co: ChangeOrder) => coStatusLabel(co.status) },
    { key: 'date', label: 'Date', csvValue: (co: ChangeOrder) => logDayKey(co.date) },
  ], []);

  const csv = useCallback(() => rowsToCsv(csvColumns, rows), [csvColumns, rows]);
  const exportSelected = useCallback((ids: string[]) => {
    const pick = rows.filter((co) => ids.includes(co.id));
    void deliverTextFile(logCsvFileName('changeOrder', project?.name, new Date()), rowsToCsv(csvColumns, pick), 'text/csv;charset=utf-8');
  }, [rows, csvColumns, project?.name]);

  const newCo = useCallback(() => router.push(routeHref('/change-order', { projectId, new: '1' })), [router, projectId]);

  const open = openId ? all.find((co) => co.id === openId) ?? null : null;
  const strip = open ? (
    <RecordContextStrip
      testID="co-log-strip"
      status={{ label: coStatusLabel(open.status) ?? '—', tone: coTone(open) }}
      facts={[
        { label: 'Approvals', value: coApprovalsLabel(open) },
        { label: 'Amount', value: logMoney(coSignedAmount(open), true) },
        { label: 'Schedule', value: coScheduleDays(open) === null ? null : `${daysLabel(coScheduleDays(open))} days` },
      ]}
    />
  ) : null;

  return (
    <LogShell
      kind="changeOrder"
      projectId={projectId}
      testID="co-log"
      detail={detail}
      strip={strip}
      csv={csv}
      renderTable={({ activeKey, onRowOpen, getRowHref }) => (
        <DataTable<ChangeOrder>
          tableId="co-log"
          testID="co-log-table"
          rows={rows}
          columns={columns}
          rowKey={(co) => co.id}
          activeKey={activeKey}
          onRowOpen={(co) => onRowOpen(co.id)}
          getRowHref={(co) => getRowHref(co.id)}
          defaultSort={{ key: 'number', dir: 'desc' }}
          searchText={coSearchText}
          searchPlaceholder="Search change orders"
          selectable
          filterChips={(
            <FilterChipRow<CoLogFilter>
              noPadding
              testID="co-log-chip"
              value={filter}
              onChange={setPicked}
              chips={CO_LOG_FILTERS.map((f) => ({ value: f.key, label: f.label, count: loading ? undefined : counts[f.key] }))}
            />
          )}
          bulkActions={[{ key: 'csv', label: 'Export CSV', run: exportSelected }]}
          footerTotals={rows.length > 0 ? {
            description: `Approved ${logMoney(totals.approved) ?? '—'} · Pending ${logMoney(totals.pending) ?? '—'} (drafts not counted)`,
            amount: logMoney(totals.approved, true),
          } : undefined}
          emptyState={loading ? (
            <EmptyState
              icon={<ClipboardList size={28} color={t.accent} />}
              title="Loading change orders…"
              message="This job's change orders appear here once they load."
            />
          ) : (
            <EmptyState
              icon={<ClipboardList size={28} color={t.accent} />}
              title={all.length === 0 ? 'No change orders on this job yet' : 'Nothing under this filter'}
              message={all.length === 0 ? 'Log added scope, the price, and who approved it.' : 'Pick another chip, or All.'}
              actionLabel="New change order"
              onAction={newCo}
            />
          )}
          renderCard={(co) => <LogCard title={`CO #${co.number} · ${co.description}`} meta={coStatusLabel(co.status)} />}
        />
      )}
    />
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  num: { ...Type.bodyCompact, color: t.text, textAlign: 'right', fontVariant: ['tabular-nums'] },
});

export default ChangeOrderLog;
