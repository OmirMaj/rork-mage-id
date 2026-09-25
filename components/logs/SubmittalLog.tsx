// components/logs/SubmittalLog.tsx — every submittal on a job, the open one
// beside it (wave 6c, lane G). DESKTOP WEB ONLY: app/submittal.tsx renders
// this only when utils/logs/logRoutes.logRouteMode says 'log' or 'split'.
//
// Nothing here writes; the record pane is the submittal screen's own form.

import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { FileCheck2 } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
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
import { logCsvFileName, logDayKey, logDayLabel } from '@/utils/logs/logRoutes';
import { defaultLogFilter } from '@/utils/logs/rfiLogRows';
import {
  SUBMITTAL_LOG_FILTERS, submittalBallInCourt, submittalCycleCount, submittalCycleLabel, submittalIsApproved,
  submittalIsLate, submittalLogChipCounts, submittalLogFilter, submittalSearchText, submittalStatusLabel,
  type SubmittalLogFilter,
} from '@/utils/logs/submittalLogRows';
import type { Submittal } from '@/types';

export interface SubmittalLogProps {
  projectId: string;
  openId?: string | null;
  detail?: React.ReactNode;
}

function submittalTone(s: Submittal, now: Date): StatusTone {
  if (submittalIsApproved(s.currentStatus)) return 'success';
  if (s.currentStatus === 'rejected') return 'error';
  if (submittalIsLate(s, now)) return 'error';
  if (s.currentStatus === 'revise_resubmit') return 'warning';
  if (s.currentStatus === 'in_review') return 'info';
  return 'neutral';
}

const leadDaysOf = (s: Submittal): number | null => (typeof s.leadDays === 'number' && Number.isFinite(s.leadDays) ? s.leadDays : null);

export function SubmittalLog({ projectId, openId, detail }: SubmittalLogProps) {
  const router = useRouter();
  const { colors: t } = useTheme();
  const { getSubmittalsForProject, getProject } = useProjects();
  const project = getProject(projectId);
  const all = useMemo(() => getSubmittalsForProject(projectId), [getSubmittalsForProject, projectId]);
  const now = useMemo(() => new Date(), [all]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => submittalLogChipCounts(all, now), [all, now]);
  const [picked, setPicked] = useState<SubmittalLogFilter | null>(null);
  const filter: SubmittalLogFilter = picked ?? defaultLogFilter<SubmittalLogFilter>('open', counts, all.length);
  const rows = useMemo(() => all.filter((s) => submittalLogFilter(s, filter, now)), [all, filter, now]);

  // hideBelow 640 on Spec § and Review cycle: in the 534 px split pane the
  // table keeps # · Title · Required · Status (the RFI log's rule).
  const columns: DataTableColumn<Submittal>[] = useMemo(() => [
    { key: 'number', label: '#', width: 56, numeric: true, sortValue: (s) => s.number, value: (s) => s.number },
    { key: 'title', label: 'Title', flex: 1, minWidth: 200, sortValue: (s) => s.title, value: (s) => s.title || null },
    { key: 'spec', label: 'Spec §', width: 96, hideBelow: 640, sortValue: (s) => s.specSection, value: (s) => s.specSection || null },
    { key: 'trade', label: 'Trade', width: 120, hideBelow: 1000, sortValue: (s) => s.trade, value: (s) => s.trade || null },
    { key: 'required', label: 'Required', width: 96, sortValue: (s) => logDayKey(s.requiredDate), value: (s) => logDayLabel(s.requiredDate, now) },
    { key: 'lead', label: 'Lead days', width: 80, numeric: true, hideBelow: 900, sortValue: leadDaysOf, value: leadDaysOf },
    { key: 'cycle', label: 'Review cycle', width: 96, hideBelow: 640, sortValue: submittalCycleCount, value: submittalCycleLabel },
    {
      key: 'status', label: 'Status', width: 120, sortValue: (s) => s.currentStatus,
      render: (s) => <StatusPill label={submittalStatusLabel(s.currentStatus) ?? '—'} tone={submittalTone(s, now)} size="compact" />,
    },
    { key: 'ball', label: 'Ball in court', width: 130, hideBelow: 800, sortValue: submittalBallInCourt, value: submittalBallInCourt },
  ], [now]);

  const csvColumns = useMemo(() => [
    { key: 'number', label: '#', csvValue: (s: Submittal) => s.number },
    { key: 'title', label: 'Title', csvValue: (s: Submittal) => s.title },
    { key: 'spec', label: 'Spec section', csvValue: (s: Submittal) => s.specSection || null },
    { key: 'trade', label: 'Trade', csvValue: (s: Submittal) => s.trade || null },
    { key: 'required', label: 'Required', csvValue: (s: Submittal) => logDayKey(s.requiredDate) },
    { key: 'lead', label: 'Lead days', csvValue: leadDaysOf },
    { key: 'cycle', label: 'Review cycle', csvValue: submittalCycleLabel },
    { key: 'status', label: 'Status', csvValue: (s: Submittal) => submittalStatusLabel(s.currentStatus) },
    { key: 'ball', label: 'Ball in court', csvValue: submittalBallInCourt },
  ], []);

  const csv = useCallback(() => rowsToCsv(csvColumns, rows), [csvColumns, rows]);
  const exportSelected = useCallback((ids: string[]) => {
    const pick = rows.filter((s) => ids.includes(s.id));
    void deliverTextFile(logCsvFileName('submittal', project?.name, new Date()), rowsToCsv(csvColumns, pick), 'text/csv;charset=utf-8');
  }, [rows, csvColumns, project?.name]);

  const newSubmittal = useCallback(() => router.push(routeHref('/submittal', { projectId, new: '1' })), [router, projectId]);

  const open = openId ? all.find((s) => s.id === openId) ?? null : null;
  const strip = open ? (
    <RecordContextStrip
      testID="submittal-log-strip"
      status={{ label: submittalStatusLabel(open.currentStatus) ?? '—', tone: submittalTone(open, now) }}
      facts={[
        { label: 'Review', value: submittalCycleLabel(open) },
        submittalIsLate(open, now)
          ? { label: 'Required', value: `${logDayLabel(open.requiredDate, now) ?? '—'} · late`, tone: 'danger' as const }
          : { label: 'Required', value: logDayLabel(open.requiredDate, now) },
        { label: 'Lead', value: leadDaysOf(open) === null ? null : `${leadDaysOf(open)} days` },
      ]}
    />
  ) : null;

  return (
    <LogShell
      kind="submittal"
      projectId={projectId}
      testID="submittal-log"
      detail={detail}
      strip={strip}
      csv={csv}
      renderTable={({ activeKey, onRowOpen, getRowHref }) => (
        <DataTable<Submittal>
          tableId="submittal-log"
          testID="submittal-log-table"
          rows={rows}
          columns={columns}
          rowKey={(s) => s.id}
          activeKey={activeKey}
          onRowOpen={(s) => onRowOpen(s.id)}
          getRowHref={(s) => getRowHref(s.id)}
          defaultSort={{ key: 'number', dir: 'desc' }}
          searchText={submittalSearchText}
          searchPlaceholder="Search submittals"
          selectable
          filterChips={(
            <FilterChipRow<SubmittalLogFilter>
              noPadding
              testID="submittal-log-chip"
              value={filter}
              onChange={setPicked}
              chips={SUBMITTAL_LOG_FILTERS.map((f) => ({ value: f.key, label: f.label, count: counts[f.key] }))}
            />
          )}
          bulkActions={[{ key: 'csv', label: 'Export CSV', run: exportSelected }]}
          emptyState={(
            <EmptyState
              icon={<FileCheck2 size={28} color={t.accent} />}
              title={all.length === 0 ? 'No submittals on this job yet' : 'Nothing under this filter'}
              message={all.length === 0 ? 'Route a product spec through the architect before you order.' : 'Pick another chip, or All.'}
              actionLabel="New submittal"
              onAction={newSubmittal}
            />
          )}
          renderCard={(s) => <LogCard title={`#${s.number} · ${s.title}`} meta={submittalStatusLabel(s.currentStatus)} />}
        />
      )}
    />
  );
}

export default SubmittalLog;
