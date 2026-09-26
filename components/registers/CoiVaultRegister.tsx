// components/registers/CoiVaultRegister.tsx — every sub's insurance in one
// sortable table, the open sub's certificates beside it (wave 6d, lane R2).
// DESKTOP WEB ONLY: app/coi-vault.tsx renders this only when useIsDesktopWeb()
// is true; the phone keeps its FeatureHeader, compliance banner and rows
// (`subcontractors.map(sub =>`), and its full-screen detail, untouched.
//
// /coi-vault?subId=X — today's deep link — opens X BESIDE the list. Every
// status is the phone's own (utils/registers/coiRows): the latest certificate
// by upload, vaultCoiExpiry / vaultCoiStatus for the expiry, and the check's
// four words from statusToVisuals. Default sort: days left, soonest first
// (a sub with no expiry sorts last).
//
// The record pane is the phone detail's own content (the screen hoists it):
// the upload button and one COICard per certificate. Each card reports its
// unsaved coverage rows (useRegisterRecordDirty), so j/k, another row, Esc or
// "Back to list" ask "Discard changes?" first.
//
// There is no New: an upload needs a chosen sub and a click on the file
// dialog. Request renewal is OFF, with its reason (nothing sends a sub a
// renewal request yet). No loaded signal exists for COIs (contract D9, named
// exception 2), so the empty state reuses the phone's copy.

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Shield } from 'lucide-react-native';
import { Layout } from '@/constants/designTokens';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { DataTable, type DataTableColumn } from '@/components/desktop/DataTable';
import type { SplitRecord } from '@/components/desktop/SplitView';
import FilterChipRow from '@/components/FilterChipRow';
import EmptyState from '@/components/EmptyState';
import { StatusPill } from '@/components/ui/StatusPill';
import { LogCard } from '@/components/logs/LogCard';
import { RecordContextStrip } from '@/components/logs/RecordContextStrip';
import { RegisterShell, exportRegisterCsv } from '@/components/registers/RegisterShell';
import { rowsToCsv } from '@/utils/dataTable';
import { logDayLabel } from '@/utils/logs/logRoutes';
import {
  COI_CHECK_LABEL, COI_CHECK_TONE, COI_CSV_COLUMNS, coiChipMatches, coiRegisterRow, coiSummary,
  type CoiChip, type CoiRegisterRow,
} from '@/utils/registers/coiRows';
import type { CertificateOfInsurance, Subcontractor } from '@/types';

/** Bulk Request renewal stays off: the cron only emails the GC (30 / 14 / 7 / 0 days). */
export const COI_RENEWAL_REASON = 'MAGE ID can’t send a renewal request to a sub yet — you get an email 30, 14 and 7 days before a COI lapses, and on the day it does. Call or email the sub from Subs.';

export interface CoiVaultRegisterProps {
  subcontractors: readonly Subcontractor[];
  cois: readonly CertificateOfInsurance[];
  /** The screen's useSplitRecord({ param: 'subId' }). */
  split: SplitRecord;
  /** The screen's Upload COI button (the phone detail header's own). */
  uploadButton: React.ReactNode;
  /** The open sub's certificates (the phone detail's own body), or null when he is not on the list. */
  detailBody: React.ReactNode | null;
}

export function CoiVaultRegister({ subcontractors, cois, split, uploadButton, detailBody }: CoiVaultRegisterProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Read once a minute, so the rows keep their identity between renders.
  const nowMs = Math.floor(Date.now() / 60_000) * 60_000;
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const all = useMemo(() => subcontractors.map((s) => coiRegisterRow(s, cois, now)), [subcontractors, cois, now]);
  const summary = useMemo(() => coiSummary(all), [all]);

  const [chip, setChip] = useState<CoiChip>('all');
  const rows = useMemo(() => all.filter((r) => coiChipMatches(r, chip)), [all, chip]);

  const dayColor = useCallback((d: number | null) => (
    d === null ? t.text : d <= 0 ? t.dangerLabel : d <= 30 ? t.warningLabel : t.text
  ), [t.text, t.dangerLabel, t.warningLabel]);

  const columns: DataTableColumn<CoiRegisterRow>[] = useMemo(() => [
    { key: 'sub', label: 'Sub', flex: 1.5, minWidth: 160, sortValue: (r) => r.sub || null, value: (r) => r.sub || null },
    {
      key: 'daysLeft', label: 'Days left', width: 90, numeric: true, sortValue: (r) => r.daysLeft,
      render: (r) => (
        <Text style={[styles.num, styles.right, { color: dayColor(r.daysLeft) }]}>{r.daysLeft === null ? '—' : String(r.daysLeft)}</Text>
      ),
    },
    {
      key: 'check', label: 'Check', width: 140, sortValue: (r) => COI_CHECK_LABEL[r.check],
      render: (r) => <StatusPill label={COI_CHECK_LABEL[r.check]} tone={COI_CHECK_TONE[r.check]} size="compact" />,
    },
    {
      key: 'expiry', label: 'Earliest expiry', width: 140, hideBelow: 650, sortValue: (r) => r.expiryDay,
      render: (r) => {
        const label = logDayLabel(r.expiryDay, now);
        return (
          <Text style={[styles.num, { color: dayColor(r.daysLeft) }]} numberOfLines={1}>
            {label ? `${label}${r.expirySource === 'record' ? ' (typed)' : ''}` : '—'}
          </Text>
        );
      },
    },
    { key: 'trade', label: 'Trade', width: 120, hideBelow: 750, sortValue: (r) => r.trade || null, value: (r) => r.trade || null },
    {
      key: 'certs', label: 'Certificates', width: 90, numeric: true, hideBelow: 850, sortValue: (r) => r.certCount,
      render: (r) => <Text style={[styles.num, styles.right]}>{String(r.certCount)}</Text>,
    },
    {
      key: 'policies', label: 'Policies on file', width: 100, numeric: true, hideBelow: 950, sortValue: (r) => r.policyCount,
      render: (r) => <Text style={[styles.num, styles.right]}>{r.policyCount === null ? '—' : String(r.policyCount)}</Text>,
    },
    {
      key: 'issues', label: 'Endorsement issues', flex: 1.2, hideBelow: 1050, sortValue: (r) => r.issueCount,
      value: (r) => (r.issueCount === null ? null : r.firstIssue ? `${r.issueCount} · ${r.firstIssue}` : String(r.issueCount)),
    },
    {
      key: 'lastUpload', label: 'Last upload', width: 110, hideBelow: 1150, sortValue: (r) => r.lastUploadAt,
      value: (r) => logDayLabel(r.lastUploadAt, now),
    },
  ], [now, dayColor, styles.num, styles.right]);

  const csv = useCallback(() => rowsToCsv(COI_CSV_COLUMNS, rows), [rows]);
  const exportSelected = useCallback((ids: string[]) => {
    exportRegisterCsv('coi-vault', rowsToCsv(COI_CSV_COLUMNS, rows.filter((r) => ids.includes(r.id))));
  }, [rows]);

  const open = split.openId ? all.find((r) => r.id === split.openId) ?? null : null;
  const detail = open && detailBody ? (
    <>
      <RecordContextStrip
        testID="coi-vault-record-strip"
        status={{ label: COI_CHECK_LABEL[open.check], tone: COI_CHECK_TONE[open.check] }}
        facts={[
          { label: 'Earliest expiry', value: open.expiryDay ? `${logDayLabel(open.expiryDay, now) ?? open.expiryDay}${open.expirySource === 'record' ? ' (typed)' : ''}` : null },
          { label: 'Days left', value: open.daysLeft === null ? null : String(open.daysLeft), tone: open.daysLeft !== null && open.daysLeft <= 0 ? 'danger' : undefined },
          { label: 'Certificates', value: String(open.certCount) },
        ]}
      />
      <View style={styles.recordHeader}>{uploadButton}</View>
      {detailBody}
    </>
  ) : (
    <EmptyState
      icon={<Shield size={28} color={t.accent} strokeWidth={1.75} />}
      title="This sub isn't on your list any more"
      message="He may have been deleted. Pick another sub from the list."
      actionLabel="Close"
      onAction={split.close}
    />
  );

  return (
    <RegisterShell
      registerId="coi-vault"
      title="COI Vault"
      testID="coi-vault-register"
      csvStem="coi-vault"
      csv={csv}
      actions={[]}
      record={{ split, param: 'subId', pathname: '/coi-vault', detail, noun: 'certificate' }}
      renderTable={({ activeKey, onRowOpen, getRowHref }) => (
        <DataTable<CoiRegisterRow>
          tableId="reg-coi-vault"
          testID="coi-vault-register-table"
          density="compact"
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          activeKey={activeKey}
          onRowOpen={(r) => onRowOpen(r.id)}
          getRowHref={(r) => getRowHref(r.id)}
          defaultSort={{ key: 'daysLeft', dir: 'asc' }}
          searchText={(r) => `${r.sub} ${r.trade}`}
          searchPlaceholder="Search subs"
          selectable
          filterChips={(
            <FilterChipRow<CoiChip>
              noPadding
              testID="coi-vault-register-chip"
              value={chip}
              onChange={setChip}
              chips={[
                { value: 'all', label: 'All', count: all.length },
                { value: 'expired', label: 'Expired', count: summary.expired },
                { value: 'expiring', label: 'Expiring <30d', count: summary.expiringSoon },
                { value: 'missing', label: 'No COI on file', count: summary.missing },
              ]}
            />
          )}
          bulkActions={[
            { key: 'csv', label: 'Export CSV', run: exportSelected },
            { key: 'renewal', label: 'Request renewal', run: () => {}, disabledReason: COI_RENEWAL_REASON },
          ]}
          emptyState={chip === 'all' ? (
            <EmptyState
              icon={<Shield size={28} color={t.accent} strokeWidth={1.75} />}
              title="No subs yet"
              message="Add subs from the Subcontractors screen first, then come back here to upload their COIs."
            />
          ) : (
            <EmptyState
              icon={<Shield size={28} color={t.accent} strokeWidth={1.75} />}
              title="Nothing under this filter"
              message="Pick another chip, or All."
            />
          )}
          renderCard={(r) => <LogCard title={r.sub || '—'} meta={COI_CHECK_LABEL[r.check]} />}
        />
      )}
    />
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  num: { ...Type.bodyCompact, color: t.text, fontVariant: ['tabular-nums'] },
  right: { textAlign: 'right' },
  recordHeader: { flexDirection: 'row', justifyContent: 'flex-start', gap: Layout.rowGap },
});

export default CoiVaultRegister;
