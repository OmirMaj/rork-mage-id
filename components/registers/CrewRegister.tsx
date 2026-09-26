// components/registers/CrewRegister.tsx — the crew roster as one sortable
// table, the open member beside it (wave 6d, lane R1). DESKTOP WEB ONLY:
// app/crew.tsx renders this only when useIsDesktopWeb() is true; the phone
// keeps its card roster (`sortedMembers.map(m =>`), untouched.
//
// Every status is the phone's own: verifiedBadge for the ID column,
// crewCertRowStatus(certExpiryStatus(...)) for the certificate counts
// (utils/registers/crewRows). Writes go through CrewContext only — bulk Mark
// inactive / Mark active call updateCrewMember one member per render
// (useOneAtATime). Bulk Delete is OFF, with its reason: a crew delete offers
// Mark inactive first and purges a kept ID photo, one member at a time.
//
// D9: until the roster read settles (useCrew().isLoading) the empty table says
// "Loading…", never "No crew yet".

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { IdCard, Plus } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { DataTable, type DataTableColumn } from '@/components/desktop/DataTable';
import type { SplitRecord } from '@/components/desktop/SplitView';
import FilterChipRow from '@/components/FilterChipRow';
import EmptyState from '@/components/EmptyState';
import { StatusPill, type StatusTone } from '@/components/ui/StatusPill';
import { LogCard } from '@/components/logs/LogCard';
import { RegisterShell, exportRegisterCsv, useOneAtATime } from '@/components/registers/RegisterShell';
import { rowsToCsv } from '@/utils/dataTable';
import { CREW_CSV_COLUMNS } from '@/utils/registers/registerCsv';
import {
  CREW_CHIPS, CREW_ID_LABEL, crewChipCounts, crewChipMatches, crewRegisterRow,
  type CrewCertLike, type CrewChip, type CrewRegisterRow,
} from '@/utils/registers/crewRows';
import type { CrewMember } from '@/types';
import type { IdBadge } from '@/utils/crew/verifiedBadge';

/** Bulk Delete stays off: the phone's delete is a one-member decision. */
export const CREW_BULK_DELETE_REASON = 'Delete crew one at a time — it offers Mark inactive first and purges a kept ID photo.';

const ID_TONE: Readonly<Record<IdBadge, StatusTone>> = {
  id_verified: 'success',
  id_expired: 'warning',
  unverified: 'neutral',
};

export interface CrewRegisterProps {
  /** The screen's sortedMembers (active first, inactive last). */
  members: readonly CrewMember[];
  /** Every certification on the account; each row counts its own (workerId). */
  certifications: readonly CrewCertLike[];
  /** todayCalendarDay(), read by the screen at render. */
  today: string;
  /** useCrew().isLoading — the roster read has not settled. */
  loading: boolean;
  /** The screen's useSplitRecord({ param: 'crewId' }). */
  split: SplitRecord;
  /** The open member's body (the phone detail sheet's content), or a reason. */
  detail: React.ReactNode | null;
  /** Opens the screen's add sheet. */
  onNew: () => void;
  updateCrewMember: (id: string, changes: Partial<CrewMember>) => void;
  /** The empty roster's second door: certifications live under Safety. */
  onOpenCertifications: () => void;
}

export function CrewRegister({
  members, certifications, today, loading, split, detail, onNew, updateCrewMember, onOpenCertifications,
}: CrewRegisterProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const all = useMemo(() => members.map((m) => crewRegisterRow(m, certifications, today)), [members, certifications, today]);
  const counts = useMemo(() => crewChipCounts(all), [all]);
  const [chip, setChip] = useState<CrewChip>('all');
  const rows = useMemo(() => all.filter((r) => crewChipMatches(r, chip)), [all, chip]);

  const columns: DataTableColumn<CrewRegisterRow>[] = useMemo(() => [
    { key: 'name', label: 'Name', flex: 1.5, minWidth: 160, sortValue: (r) => r.name, value: (r) => r.name || null },
    {
      key: 'status', label: 'Status', width: 100, sortValue: (r) => (r.active ? 0 : 1),
      render: (r) => <StatusPill label={r.active ? 'Active' : 'Inactive'} tone={r.active ? 'success' : 'neutral'} size="compact" />,
    },
    {
      key: 'id', label: 'ID', width: 160, hideBelow: 600, sortValue: (r) => CREW_ID_LABEL[r.idBadge],
      render: (r) => <StatusPill label={CREW_ID_LABEL[r.idBadge]} tone={ID_TONE[r.idBadge]} size="compact" />,
    },
    { key: 'trades', label: 'Trades', flex: 1.2, hideBelow: 700, sortValue: (r) => r.trades || null, value: (r) => r.trades || null },
    {
      key: 'certs', label: 'Certs', width: 150, hideBelow: 800, sortValue: (r) => r.certCount,
      render: (r) => (
        <Text style={styles.cell} numberOfLines={1}>
          <Text style={styles.num}>{String(r.certCount)}</Text>
          {r.certExpiring > 0 ? <Text style={{ color: t.warningLabel }}>{` · ${r.certExpiring} expiring`}</Text> : null}
          {r.certExpired > 0 ? <Text style={{ color: t.dangerLabel }}>{` · ${r.certExpired} expired`}</Text> : null}
        </Text>
      ),
    },
    {
      key: 'projects', label: 'Projects', width: 80, numeric: true, hideBelow: 950, sortValue: (r) => r.projectCount,
      render: (r) => <Text style={[styles.num, styles.right]}>{String(r.projectCount)}</Text>,
    },
    { key: 'claimed', label: 'Claimed', width: 100, hideBelow: 1050, sortValue: (r) => (r.claimed ? 0 : 1), value: (r) => (r.claimed ? 'Claimed' : 'No') },
    { key: 'phone', label: 'Phone', width: 130, hideBelow: 1150, sortValue: (r) => r.phone, value: (r) => r.phone },
  ], [styles.cell, styles.num, styles.right, t.warningLabel, t.dangerLabel]);

  const csv = useCallback(() => rowsToCsv(CREW_CSV_COLUMNS, rows), [rows]);
  const exportSelected = useCallback((ids: string[]) => {
    exportRegisterCsv('crew', rowsToCsv(CREW_CSV_COLUMNS, rows.filter((r) => ids.includes(r.id))));
  }, [rows]);

  const setStatusEach = useOneAtATime((job: { id: string; status: CrewMember['status'] }) => {
    updateCrewMember(job.id, { status: job.status });
  });
  const markInactive = useCallback((ids: string[]) => {
    setStatusEach(ids.map((id) => ({ id, status: 'inactive' as const })));
  }, [setStatusEach]);
  const markActive = useCallback((ids: string[]) => {
    setStatusEach(ids.map((id) => ({ id, status: 'active' as const })));
  }, [setStatusEach]);

  const emptyState = loading ? (
    <EmptyState
      icon={<IdCard size={28} color={t.accent} strokeWidth={1.75} />}
      title="Loading…"
      message="Your crew roster appears here once it loads."
    />
  ) : all.length === 0 ? (
    <EmptyState
      icon={<IdCard size={28} color={t.accent} strokeWidth={1.75} />}
      title="No crew yet"
      message={
        certifications.length > 0
          ? `Add your first crew member to build a verified roster. Looking for a certification? ${certifications.length} ${certifications.length === 1 ? 'is' : 'are'} on file under Safety — certifications are tracked separately from the roster.`
          : 'Add your first crew member to build a verified roster.'
      }
      actionLabel="Add crew member"
      onAction={onNew}
      secondaryLabel={certifications.length > 0 ? 'Open certifications' : undefined}
      onSecondaryAction={certifications.length > 0 ? onOpenCertifications : undefined}
    />
  ) : (
    <EmptyState
      icon={<IdCard size={28} color={t.accent} strokeWidth={1.75} />}
      title="Nothing under this filter"
      message="Pick another chip, or All."
    />
  );

  return (
    <RegisterShell
      registerId="crew"
      title="Crew"
      testID="crew-register"
      csvStem="crew"
      csv={csv}
      onNew={onNew}
      actions={[{ key: 'new', label: 'Add crew member', primary: true, icon: Plus, onPress: onNew, testID: 'crew-register-new' }]}
      record={{ split, param: 'crewId', pathname: '/crew', detail, noun: 'crew member' }}
      renderTable={({ activeKey, onRowOpen, getRowHref }) => (
          <DataTable<CrewRegisterRow>
            tableId="reg-crew"
            testID="crew-register-table"
            density="compact"
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            activeKey={activeKey}
            onRowOpen={(r) => onRowOpen(r.id)}
            getRowHref={(r) => getRowHref(r.id)}
            defaultSort={null}
            searchText={(r) => `${r.name} ${r.trades} ${r.phone ?? ''} ${r.email ?? ''}`}
            searchPlaceholder="Search crew"
            selectable
            filterChips={(
              <FilterChipRow<CrewChip>
                noPadding
                testID="crew-register-chip"
                value={chip}
                onChange={setChip}
                chips={CREW_CHIPS.map((c) => ({ value: c.key, label: c.label, count: loading ? undefined : counts[c.key] }))}
              />
            )}
            bulkActions={[
              { key: 'inactive', label: 'Mark inactive', run: markInactive },
              { key: 'active', label: 'Mark active', run: markActive },
              { key: 'csv', label: 'Export CSV', run: exportSelected },
              { key: 'delete', label: 'Delete', destructive: true, run: () => {}, disabledReason: CREW_BULK_DELETE_REASON },
            ]}
            emptyState={emptyState}
            renderCard={(r) => <LogCard title={r.name || '—'} meta={r.trades || null} />}
          />
      )}
    />
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  cell: { ...Type.bodyCompact, color: t.text },
  num: { ...Type.bodyCompact, color: t.text, fontVariant: ['tabular-nums'] },
  right: { textAlign: 'right' },
});

export default CrewRegister;
