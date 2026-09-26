// components/registers/SubsRegister.tsx — every subcontractor in one sortable
// table, the open one beside it (wave 6d, lane R2). DESKTOP WEB ONLY:
// app/(tabs)/subs/index.tsx renders this only when useIsDesktopWeb() is true;
// the phone keeps its launcher banners, stat cards, search box and card list
// (`renderItem={renderSub}`), untouched.
//
// Compliance is the phone's own rule (getComplianceStatus / complianceLabel via
// utils/registers/subRows), and the chip counts are the phone's stat cards,
// count for count (subStatusCounts). The grade is the same computeSubScorecards
// card the phone's detail sheet and /sub-scorecard show.
//
// Writes go through the screen only: its add/edit sheet (framed on desktop)
// and the record's own Delete, which checks for payments on record first.
// Bulk Delete is OFF, with its reason — that check is one sub at a time.
//
// No loaded signal exists for subs (contract D9, named exception 2), so the
// empty state reuses the phone's copy and can show before the first load,
// exactly as the phone does today.

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { HardHat, Plus, ShieldCheck, UserPlus, Users } from 'lucide-react-native';
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
import { RegisterShell, exportRegisterCsv } from '@/components/registers/RegisterShell';
import { rowsToCsv } from '@/utils/dataTable';
import { logDayLabel } from '@/utils/logs/logRoutes';
import { computeSubScorecards, type SubScorecardInput } from '@/utils/subScorecard';
import {
  SUB_CSV_COLUMNS, complianceTone, subChipMatches, subRegisterRow, subSearchText, subStatusCounts,
  subTradeCounts, subsByUpdated, type SubChip, type SubRegisterRow,
} from '@/utils/registers/subRows';
import { SUB_TRADES, type Subcontractor } from '@/types';

/** Bulk Delete stays off: the phone's delete checks each sub for money on record. */
export const SUBS_BULK_DELETE_REASON = 'Delete subs one at a time — each is checked for payments on record so the 1099 export keeps his TIN and address.';

export interface SubsRegisterProps {
  subcontractors: Subcontractor[];
  /** The scorecard's other inputs — the same five the phone detail sheet passes. */
  commitments: SubScorecardInput['commitments'];
  changeOrders: SubScorecardInput['changeOrders'];
  punchItems: SubScorecardInput['punchItems'];
  projects: SubScorecardInput['projects'];
  rfis: SubScorecardInput['rfis'];
  /** The screen's useSplitRecord({ param: 'subId' }). */
  split: SplitRecord;
  /** The open sub's body (the phone detail sheet's own content), or the missing-record state. */
  detail: React.ReactNode | null;
  /** The phone banner's prequal numbers. */
  prequal: { approved: number; pending: number };
  /** Opens the screen's add sheet. */
  onNew: () => void;
  onInvite: () => void;
}

export function SubsRegister({
  subcontractors, commitments, changeOrders, punchItems, projects, rfis, split, detail, prequal, onNew, onInvite,
}: SubsRegisterProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  // The same card /sub-scorecard renders — desktop only (this mounts only there).
  const scoreBySub = useMemo(() => new Map(
    computeSubScorecards({ subcontractors, commitments, changeOrders, punchItems, projects, rfis }).cards.map((c) => [c.subId, c]),
  ), [subcontractors, commitments, changeOrders, punchItems, projects, rfis]);

  // Read once a minute, so the rows keep their identity between renders.
  const nowMs = Math.floor(Date.now() / 60_000) * 60_000;
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  // The phone's list order (updatedAt, newest first), on a copy.
  const all = useMemo(
    () => subsByUpdated(subcontractors.map((s) => subRegisterRow(s, commitments, scoreBySub.get(s.id) ?? null, nowMs))),
    [subcontractors, commitments, scoreBySub, nowMs],
  );
  const counts = useMemo(() => subStatusCounts(subcontractors, nowMs), [subcontractors, nowMs]);
  const trades = useMemo(() => subTradeCounts(subcontractors, SUB_TRADES), [subcontractors]);

  const [chip, setChip] = useState<SubChip>('all');
  // A chip whose last sub left falls back to All.
  const chipCount = (c: SubChip): number => all.filter((r) => subChipMatches(r, c)).length;
  const filter: SubChip = chip !== 'all' && chipCount(chip) === 0 ? 'all' : chip;
  const rows = useMemo(() => all.filter((r) => subChipMatches(r, filter)), [all, filter]);

  const columns: DataTableColumn<SubRegisterRow>[] = useMemo(() => [
    { key: 'company', label: 'Company', flex: 1.5, minWidth: 160, sortValue: (r) => r.company || null, value: (r) => r.company || null },
    { key: 'trade', label: 'Trade', width: 120, sortValue: (r) => r.trade || null, value: (r) => r.trade || null },
    {
      key: 'compliance', label: 'Compliance', width: 160, sortValue: (r) => r.complianceLabel,
      render: (r) => <StatusPill label={r.complianceLabel} tone={complianceTone(r.compliance)} size="compact" />,
    },
    {
      key: 'coi', label: 'COI expiry', width: 110, hideBelow: 700, sortValue: (r) => r.coiDay,
      render: (r) => {
        const label = logDayLabel(r.coiDay, now);
        const d = r.coiDaysLeft;
        const color = d === null ? t.text : d <= 0 ? t.dangerLabel : d <= 30 ? t.warningLabel : t.text;
        return <Text style={[styles.num, { color }]} numberOfLines={1}>{label ?? '—'}</Text>;
      },
    },
    {
      key: 'score', label: 'Score', width: 90, numeric: true, hideBelow: 800, sortValue: (r) => r.score,
      render: (r) => <Text style={[styles.num, styles.right]}>{r.grade !== null && r.score !== null ? `${r.grade} · ${r.score}` : '—'}</Text>,
    },
    {
      key: 'open', label: 'Open commitments', width: 130, numeric: true, hideBelow: 900, sortValue: (r) => r.openCommitments,
      render: (r) => <Text style={[styles.num, styles.right]}>{String(r.openCommitments)}</Text>,
    },
    { key: 'contact', label: 'Contact', flex: 1, hideBelow: 1000, sortValue: (r) => r.contact || null, value: (r) => r.contact || null },
    { key: 'phone', label: 'Phone', width: 130, hideBelow: 1100, sortValue: (r) => r.phone, value: (r) => r.phone },
    { key: 'email', label: 'Email', flex: 1.2, hideBelow: 1200, sortValue: (r) => r.email, value: (r) => r.email },
  ], [now, styles.num, styles.right, t.text, t.dangerLabel, t.warningLabel]);

  const csv = useCallback(() => rowsToCsv(SUB_CSV_COLUMNS, rows), [rows]);
  const exportSelected = useCallback((ids: string[]) => {
    exportRegisterCsv('subs', rowsToCsv(SUB_CSV_COLUMNS, rows.filter((r) => ids.includes(r.id))));
  }, [rows]);

  const chips = useMemo(() => {
    const out: { value: SubChip; label: string; count: number }[] = [
      { value: 'all', label: 'All', count: counts.total },
      { value: 'compliant', label: 'Compliant', count: counts.compliant },
      { value: 'expiring', label: 'Expiring', count: counts.expiring },
      { value: 'expired', label: 'Expired', count: counts.expired },
    ];
    if (counts.unknown > 0) out.push({ value: 'unknown', label: 'No docs', count: counts.unknown });
    for (const tr of trades) out.push({ value: `trade:${tr.trade}`, label: tr.trade, count: tr.count });
    return out;
  }, [counts, trades]);

  const filtered = filter !== 'all';

  return (
    <RegisterShell
      registerId="subs"
      title="Subs"
      testID="subs-register"
      csvStem="subs"
      csv={csv}
      onNew={onNew}
      restoreHeaderOnExit={false}
      actions={[
        { key: 'new', label: 'Add subcontractor', primary: true, icon: Plus, onPress: onNew, testID: 'subs-register-new' },
        { key: 'invite', label: 'Invite subs', icon: UserPlus, onPress: onInvite, testID: 'subs-register-invite' },
        {
          key: 'prequal', label: `Prequal (${prequal.approved} approved · ${prequal.pending} pending)`, icon: ShieldCheck,
          onPress: () => router.push('/prequal-manager'), testID: 'subs-register-prequal',
        },
        { key: 'portals', label: 'Sub portals', icon: HardHat, onPress: () => router.push('/sub-portals'), testID: 'subs-register-portals' },
        { key: 'coi', label: 'COI vault', icon: ShieldCheck, onPress: () => router.push('/coi-vault'), testID: 'subs-register-coi' },
      ]}
      record={{ split, param: 'subId', pathname: '/(tabs)/subs', detail, noun: 'subcontractor' }}
      renderTable={({ activeKey, onRowOpen, getRowHref }) => (
        <DataTable<SubRegisterRow>
          tableId="reg-subs"
          testID="subs-register-table"
          density="compact"
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          activeKey={activeKey}
          onRowOpen={(r) => onRowOpen(r.id)}
          getRowHref={(r) => getRowHref(r.id)}
          defaultSort={null}
          searchText={subSearchText}
          searchPlaceholder="Search subcontractors"
          selectable
          filterChips={(
            <FilterChipRow<SubChip>
              noPadding
              testID="subs-register-chip"
              value={filter}
              onChange={setChip}
              chips={chips}
            />
          )}
          bulkActions={[
            { key: 'csv', label: 'Export CSV', run: exportSelected },
            { key: 'delete', label: 'Delete', destructive: true, run: () => {}, disabledReason: SUBS_BULK_DELETE_REASON },
          ]}
          emptyState={(
            <EmptyState
              icon={<Users size={28} color={t.accent} strokeWidth={1.75} />}
              title={filtered ? 'No Results' : 'No Subcontractors'}
              message={filtered ? 'Pick another chip, or All.' : 'Add your first subcontractor to start tracking compliance.'}
              actionLabel={filtered ? undefined : 'Add Subcontractor'}
              onAction={filtered ? undefined : onNew}
            />
          )}
          renderCard={(r) => <LogCard title={r.company || '—'} meta={r.trade || null} />}
        />
      )}
    />
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  num: { ...Type.bodyCompact, color: t.text, fontVariant: ['tabular-nums'] },
  right: { textAlign: 'right' },
});

export default SubsRegister;
