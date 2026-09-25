// components/logs/InvoiceLog.tsx — every invoice on a job, the open one
// beside it (wave 6c, lane G). DESKTOP WEB ONLY: app/invoice.tsx renders this
// only when utils/logs/logRoutes.logRouteMode says 'log' or 'split' — never
// for the tutorial's /invoice?projectId&type=progress (a create signal).
//
// The record pane is the invoice screen's own editor. The one write here is
// the bulk "Mark sent" (wave 6d, lane V3): drafts only, never on the sample
// job, behind a confirm, one invoice at a time through updateInvoice (the
// offline queue) with the exact patch the invoice screen's "Mark sent" writes
// (markSentPatch). It emails nobody. Until invoicesLoaded the empty table says
// "Loading invoices…", never "No invoices on this job yet".
// The balance, status and aging are the app's own rules (netBalanceDue,
// getEffectiveInvoiceStatus, getDaysPastDue) — see utils/logs/invoiceLogRows.

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Receipt } from 'lucide-react-native';
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
import { showAlert } from '@/utils/alert';
import { isSampleProject } from '@/utils/sampleGuard';
import { logBulkSkippedLine } from '@/utils/logs/rfiLogRows';
import { deliverTextFile } from '@/utils/platformFile';
import { logCsvFileName, logDayKey, logDayLabel, logMoney } from '@/utils/logs/logRoutes';
import {
  INVOICE_LOG_FILTERS, invoiceAgingDays, invoiceAgingLabel, invoiceBalance, invoiceBulkMarkSentPlan, invoiceLogChipCounts, invoiceLogFilter,
  invoiceLogStatus, invoiceLogTotals, invoiceQboLabel, invoiceSearchText, invoiceStatusLabel, invoiceTypeLabel,
  type InvoiceLogFilter,
} from '@/utils/logs/invoiceLogRows';
import type { Invoice, InvoiceStatus } from '@/types';

export interface InvoiceLogProps {
  projectId: string;
  openId?: string | null;
  detail?: React.ReactNode;
}

function invoiceTone(s: InvoiceStatus): StatusTone {
  switch (s) {
    case 'paid': return 'success';
    case 'overdue': return 'error';
    case 'partially_paid': return 'warning';
    case 'sent': return 'info';
    default: return 'neutral';
  }
}

export function InvoiceLog({ projectId, openId, detail }: InvoiceLogProps) {
  const router = useRouter();
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { getInvoicesForProject, getProject, invoicesLoaded, updateInvoice } = useProjects();
  const project = getProject(projectId);
  const all = useMemo(() => getInvoicesForProject(projectId), [getInvoicesForProject, projectId]);
  const now = useMemo(() => new Date(), [all]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nothing on this device and the collection not loaded: no empty copy, no counts.
  const loading = all.length === 0 && !invoicesLoaded;

  const counts = useMemo(() => invoiceLogChipCounts(all), [all]);
  // Opens on All: the footer's Total / Paid / Balance are the job's billing,
  // not one chip's slice of it.
  const [filter, setPicked] = useState<InvoiceLogFilter>('all');
  const rows = useMemo(() => all.filter((inv) => invoiceLogFilter(inv, filter)), [all, filter]);
  const totals = useMemo(() => invoiceLogTotals(rows), [rows]);

  const moneyCell = useCallback((n: number | null | undefined) => (
    <Text style={styles.num}>{logMoney(n) ?? '—'}</Text>
  ), [styles.num]);

  // In the 534 px split pane the table keeps # · Type · Due · Balance ·
  // Status; Issued / Total / Paid / Aging come back on the full-width log.
  const columns: DataTableColumn<Invoice>[] = useMemo(() => [
    { key: 'number', label: '#', width: 56, numeric: true, sortValue: (inv) => inv.number, value: (inv) => inv.number },
    { key: 'type', label: 'Type', width: 88, flex: 1, sortValue: (inv) => inv.type, value: invoiceTypeLabel },
    { key: 'issued', label: 'Issued', width: 96, hideBelow: 700, sortValue: (inv) => logDayKey(inv.issueDate), value: (inv) => logDayLabel(inv.issueDate, now) },
    { key: 'due', label: 'Due', width: 96, sortValue: (inv) => logDayKey(inv.dueDate), value: (inv) => logDayLabel(inv.dueDate, now) },
    { key: 'total', label: 'Total', width: 112, numeric: true, hideBelow: 700, sortValue: (inv) => inv.totalDue, render: (inv) => moneyCell(inv.totalDue) },
    { key: 'paid', label: 'Paid', width: 112, numeric: true, hideBelow: 700, sortValue: (inv) => inv.amountPaid, render: (inv) => moneyCell(inv.amountPaid) },
    { key: 'balance', label: 'Balance', width: 112, numeric: true, sortValue: invoiceBalance, render: (inv) => moneyCell(invoiceBalance(inv)) },
    {
      key: 'aging', label: 'Aging', width: 80, hideBelow: 640, sortValue: invoiceAgingDays,
      render: (inv) => {
        const d = invoiceAgingDays(inv);
        return <Text style={[styles.cell, d !== null && d > 0 && { color: t.dangerLabel }]}>{invoiceAgingLabel(inv) ?? '—'}</Text>;
      },
    },
    {
      key: 'status', label: 'Status', width: 110, sortValue: invoiceLogStatus,
      render: (inv) => {
        const s = invoiceLogStatus(inv);
        return <StatusPill label={invoiceStatusLabel(s) ?? '—'} tone={invoiceTone(s)} size="compact" />;
      },
    },
    { key: 'qbo', label: 'QBO', width: 80, hideBelow: 1100, sortValue: invoiceQboLabel, value: invoiceQboLabel },
  ], [now, moneyCell, styles.cell, t.dangerLabel]);

  const csvColumns = useMemo(() => [
    { key: 'number', label: 'Invoice', csvValue: (inv: Invoice) => inv.number },
    { key: 'type', label: 'Type', csvValue: invoiceTypeLabel },
    { key: 'issued', label: 'Issued', csvValue: (inv: Invoice) => logDayKey(inv.issueDate) },
    { key: 'due', label: 'Due', csvValue: (inv: Invoice) => logDayKey(inv.dueDate) },
    { key: 'total', label: 'Total', csvValue: (inv: Invoice) => inv.totalDue },
    { key: 'paid', label: 'Paid', csvValue: (inv: Invoice) => inv.amountPaid },
    { key: 'balance', label: 'Balance', csvValue: invoiceBalance },
    { key: 'aging', label: 'Days past due', csvValue: invoiceAgingDays },
    { key: 'status', label: 'Status', csvValue: (inv: Invoice) => invoiceStatusLabel(invoiceLogStatus(inv)) },
    { key: 'qbo', label: 'QuickBooks', csvValue: invoiceQboLabel },
  ], []);

  const csv = useCallback(() => rowsToCsv(csvColumns, rows), [csvColumns, rows]);
  const exportSelected = useCallback((ids: string[]) => {
    const pick = rows.filter((inv) => ids.includes(inv.id));
    void deliverTextFile(logCsvFileName('invoice', project?.name, new Date()), rowsToCsv(csvColumns, pick), 'text/csv;charset=utf-8');
  }, [rows, csvColumns, project?.name]);

  const newInvoice = useCallback(() => router.push(routeHref('/invoice', { projectId, new: '1' })), [router, projectId]);

  // Bulk Mark sent: drafts only, each with the invoice screen's own patch.
  // It confirms first, names what it skips, and emails nobody.
  const markSentSelected = useCallback((ids: string[]) => {
    const picked = all.filter((inv) => ids.includes(inv.id));
    const plan = invoiceBulkMarkSentPlan(picked, new Date().toISOString(), (pid) => isSampleProject(getProject(pid)));
    const skippedLine = logBulkSkippedLine(plan.skipped);
    const n = plan.mark.length;
    if (n === 0) {
      showAlert('Nothing to mark sent', skippedLine || 'Pick draft invoices to mark them sent.', [{ text: 'OK' }]);
      return;
    }
    showAlert(
      `Mark ${n} invoice${n === 1 ? '' : 's'} sent?`,
      `This does not email anything. Each one's issue date becomes today, its due date today + its terms, payment reminders start, and QuickBooks gets it.${skippedLine ? `\n\n${skippedLine}` : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Mark ${n} sent`, onPress: () => plan.mark.forEach((m) => updateInvoice(m.id, m.patch)) },
      ],
    );
  }, [all, getProject, updateInvoice]);

  const open = openId ? all.find((inv) => inv.id === openId) ?? null : null;
  const openStatus = open ? invoiceLogStatus(open) : null;
  const strip = open && openStatus ? (
    <RecordContextStrip
      testID="invoice-log-strip"
      status={{ label: invoiceStatusLabel(openStatus) ?? '—', tone: invoiceTone(openStatus) }}
      facts={[
        { label: 'Balance', value: logMoney(invoiceBalance(open)) },
        (invoiceAgingDays(open) ?? 0) > 0
          ? { label: 'Aging', value: `${invoiceAgingDays(open)} days past due`, tone: 'danger' as const }
          : { label: 'Aging', value: invoiceAgingLabel(open) },
        { label: 'QuickBooks', value: invoiceQboLabel(open) },
      ]}
    />
  ) : null;

  return (
    <LogShell
      kind="invoice"
      projectId={projectId}
      testID="invoice-log"
      detail={detail}
      strip={strip}
      csv={csv}
      renderTable={({ activeKey, onRowOpen, getRowHref }) => (
        <DataTable<Invoice>
          tableId="invoice-log"
          testID="invoice-log-table"
          rows={rows}
          columns={columns}
          rowKey={(inv) => inv.id}
          activeKey={activeKey}
          onRowOpen={(inv) => onRowOpen(inv.id)}
          getRowHref={(inv) => getRowHref(inv.id)}
          defaultSort={{ key: 'number', dir: 'desc' }}
          searchText={invoiceSearchText}
          searchPlaceholder="Search invoices"
          selectable
          filterChips={(
            <FilterChipRow<InvoiceLogFilter>
              noPadding
              testID="invoice-log-chip"
              value={filter}
              onChange={setPicked}
              chips={INVOICE_LOG_FILTERS.map((f) => ({ value: f.key, label: f.label, count: loading ? undefined : counts[f.key] }))}
            />
          )}
          bulkActions={[
            { key: 'csv', label: 'Export CSV', run: exportSelected },
            { key: 'sent', label: 'Mark sent', run: markSentSelected },
          ]}
          footerTotals={rows.length > 0 ? {
            total: logMoney(totals.total),
            paid: logMoney(totals.paid),
            balance: logMoney(totals.balance),
          } : undefined}
          emptyState={loading ? (
            <EmptyState
              icon={<Receipt size={28} color={t.accent} />}
              title="Loading invoices…"
              message="This job's invoices appear here once they load."
            />
          ) : (
            <EmptyState
              icon={<Receipt size={28} color={t.accent} />}
              title={all.length === 0 ? 'No invoices on this job yet' : 'Nothing under this filter'}
              message={all.length === 0 ? 'Bill a progress draw or the full amount.' : 'Pick another chip, or All.'}
              actionLabel="New invoice"
              onAction={newInvoice}
            />
          )}
          renderCard={(inv) => <LogCard title={`Invoice #${inv.number} · ${invoiceTypeLabel(inv)}`} meta={invoiceStatusLabel(invoiceLogStatus(inv))} />}
        />
      )}
    />
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  num: { ...Type.bodyCompact, color: t.text, textAlign: 'right', fontVariant: ['tabular-nums'] },
  cell: { ...Type.bodyCompact, color: t.text, fontVariant: ['tabular-nums'] },
});

export default InvoiceLog;
