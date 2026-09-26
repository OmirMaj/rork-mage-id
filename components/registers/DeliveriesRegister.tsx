// components/registers/DeliveriesRegister.tsx — a job's deliveries as two
// tables (wave 6d, lane R3). DESKTOP WEB ONLY: app/deliveries.tsx renders it
// only when useIsDesktopWeb() is true; the phone keeps its rows
// (`look.upcoming.map(v =>`), untouched.
//
// LATE SITS ABOVE THE HORIZON, ALWAYS — the phone's rule, kept: the Late table
// is not bounded by the 7/14/28 control and is never collapsed. The Upcoming
// table is the look-ahead. Every flag, word and colour is the phone Row's
// (utils/registers/deliveryRows over utils/deliverySchedule), and the building
// objection is conflictsForDelivery's first conflict for the load. Late and
// the horizon ride in renderTable (the shell's scrolling body), never in the
// fixed `above` slot: an unbounded late list there would starve the look-ahead.
//
// Writes are the screen's own handlers: Confirm is one status write (bulk
// Confirm runs it one delivery per render — updateDelivery rebuilds the list
// from the array it closed over). Received opens the screen's Receive sheet;
// bulk "Mark received" is OFF with its reason, because the damage question is
// asked for every load.
//
// The row buttons reuse the phone's confirm-<id> / receive-<id> testIDs: the
// register and the phone Row never mount together.

import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Building2, Plus, Truck } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { Layout } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { DataTable, type DataTableColumn } from '@/components/desktop/DataTable';
import { NoticeStrip } from '@/components/desktop/NoticeStrip';
import { routeHref } from '@/components/desktop/RowLink';
import EmptyState from '@/components/EmptyState';
import { Button, SegmentedControl } from '@/components/ui';
import { LogCard } from '@/components/logs/LogCard';
import { RegisterShell, exportRegisterCsv, useOneAtATime } from '@/components/registers/RegisterShell';
import { rowsToCsv } from '@/utils/dataTable';
import { fileSlug, logDayKey, logDayLabel } from '@/utils/logs/logRoutes';
import {
  LOOKAHEAD_DAYS, summarizeLookahead,
  type Delivery, type DeliveryLookahead, type LookaheadDays,
} from '@/utils/deliverySchedule';
import { conflictsForDelivery, type AccessConflict } from '@/utils/buildingAccess';
import { DELIVERY_CSV_COLUMNS, deliveryRegisterRow, type DeliveryRegisterRow } from '@/utils/registers/deliveryRows';

/** Bulk "Mark received" stays off: receiving asks about damage per load. */
export const DELIVERY_BULK_RECEIVE_REASON = 'Receive each load on its own — the damage question is asked for every delivery.';

export interface DeliveriesRegisterProps {
  projectId: string;
  projectName: string;
  look: DeliveryLookahead;
  horizon: LookaheadDays;
  onHorizon: (d: LookaheadDays) => void;
  /** Every access conflict for the job (findAccessConflicts). */
  conflicts: readonly AccessConflict[];
  /** The ones tied to no single load (a missing building COI stops them all). */
  projectConflicts: readonly AccessConflict[];
  /** Building-access rules are recorded for the job. */
  hasAccessRules: boolean;
  onConfirm: (d: Delivery) => void;
  onReceive: (d: Delivery) => void;
  onAdd: () => void;
  onOpenBuildingAccess: () => void;
}

export function DeliveriesRegister({
  projectId, projectName, look, horizon, onHorizon, conflicts, projectConflicts, hasAccessRules,
  onConfirm, onReceive, onAdd, onOpenBuildingAccess,
}: DeliveriesRegisterProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const byId = useMemo(() => {
    const m = new Map<string, Delivery>();
    for (const v of [...look.late, ...look.upcoming]) m.set(v.delivery.id, v.delivery);
    return m;
  }, [look]);
  const toRow = useCallback(
    (v: DeliveryLookahead['upcoming'][number]) => deliveryRegisterRow(v, conflictsForDelivery([...conflicts], v.delivery.id)),
    [conflicts],
  );
  const lateRows = useMemo(() => look.late.map(toRow), [look.late, toRow]);
  const upcomingRows = useMemo(() => look.upcoming.map(toRow), [look.upcoming, toRow]);

  const confirmEach = useOneAtATime((d: Delivery) => onConfirm(d));
  const confirmSelected = useCallback((ids: string[]) => {
    confirmEach(ids.map((id) => byId.get(id)).filter((d): d is Delivery => !!d && d.status !== 'confirmed'));
  }, [byId, confirmEach]);

  const csvStem = `deliveries-${fileSlug(projectName)}`;
  const csv = useCallback(() => rowsToCsv(DELIVERY_CSV_COLUMNS, [...lateRows, ...upcomingRows]), [lateRows, upcomingRows]);
  const exportSelected = useCallback((ids: string[]) => {
    exportRegisterCsv(csvStem, rowsToCsv(DELIVERY_CSV_COLUMNS, [...lateRows, ...upcomingRows].filter((r) => ids.includes(r.id))));
  }, [csvStem, lateRows, upcomingRows]);

  const columns: DataTableColumn<DeliveryRegisterRow>[] = useMemo(() => {
    const now = new Date();
    const toneColor = (r: DeliveryRegisterRow) => (r.tone === 'danger' ? t.dangerLabel : r.tone === 'accent' ? t.accentLabel : t.textSecondary);
    return [
      {
        key: 'flag', label: 'Flag', width: 140, sortValue: (r) => r.daysOut,
        render: (r) => <Text style={[styles.flag, { color: toneColor(r) }]} numberOfLines={1}>{r.flagLabel}</Text>,
      },
      { key: 'what', label: 'What', flex: 2, minWidth: 160, sortValue: (r) => r.what, value: (r) => r.what || null },
      {
        key: 'promised', label: 'Promised', width: 100, sortValue: (r) => logDayKey(r.promisedDay),
        render: (r) => <Text style={styles.num} numberOfLines={1}>{logDayLabel(r.promisedDay, now) ?? '—'}</Text>,
      },
      { key: 'supplier', label: 'Supplier', flex: 1.2, hideBelow: 700, sortValue: (r) => r.supplier, value: (r) => r.supplier },
      { key: 'window', label: 'Window', width: 100, hideBelow: 900, sortValue: (r) => r.window, value: (r) => r.window },
      { key: 'po', label: 'PO', width: 90, hideBelow: 1000, sortValue: (r) => r.po, value: (r) => r.po },
      {
        key: 'building', label: 'Building', flex: 1.2, hideBelow: 1100, sortValue: (r) => r.firstConflict?.message ?? null,
        render: (r) => (r.firstConflict ? (
          <Text
            style={[styles.cell, { color: r.firstConflict.severity === 'blocking' ? t.dangerLabel : t.warningLabel }]}
            numberOfLines={1}
          >
            {r.firstConflict.message}{r.conflictCount > 1 ? ` · +${r.conflictCount - 1} more` : ''}
          </Text>
        ) : <Text style={styles.muted}>—</Text>),
      },
      {
        key: 'actions', label: 'Actions', width: 200,
        render: (r) => {
          const d = byId.get(r.id);
          if (!d) return null;
          return (
            <View style={styles.actions}>
              {!r.confirmed ? (
                <Button size="sm" variant="secondary" label="Confirm" testID={`confirm-${r.id}`} onPress={() => onConfirm(d)} />
              ) : null}
              <Button size="sm" label="Received" testID={`receive-${r.id}`} onPress={() => onReceive(d)} />
            </View>
          );
        },
      },
    ];
  }, [styles, t.dangerLabel, t.accentLabel, t.textSecondary, t.warningLabel, byId, onConfirm, onReceive]);

  const card = (r: DeliveryRegisterRow) => <LogCard title={r.what || '—'} meta={r.flagLabel} />;
  const truck = <Truck size={28} color={t.accent} strokeWidth={1.6} />;

  // Only the building notices sit in the shell's fixed `above` slot. The Late
  // table and the horizon control live INSIDE the scrolling body with the
  // Upcoming table: late loads are not bounded by the horizon, so a job with a
  // dozen of them would otherwise push the look-ahead to 0 px and out of reach.
  const above = projectConflicts.length > 0 ? (
    <NoticeStrip
      testID="deliveries-register-notices"
      notices={projectConflicts.map((c, i) => ({
        id: `${c.kind}-${i}`,
        message: c.message,
        tone: c.severity === 'blocking' ? 'bad' : 'warn',
        action: { label: c.action, onPress: onOpenBuildingAccess },
      }))}
    />
  ) : null;

  const lead = (
    <>
      {lateRows.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: t.dangerLabel }]}>{`${lateRows.length} late`}</Text>
          <DataTable<DeliveryRegisterRow>
            tableId="reg-deliveries-late"
            testID="deliveries-register-late"
            density="compact"
            hotkeys={false}
            rows={lateRows}
            columns={columns}
            rowKey={(r) => r.id}
            defaultSort={{ key: 'promised', dir: 'asc' }}
            renderCard={card}
          />
        </View>
      ) : null}
      <SegmentedControl<string>
        options={LOOKAHEAD_DAYS.map((d) => ({ value: String(d), label: `${d} days`, testID: `deliveries-register-horizon-${d}` }))}
        value={String(horizon)}
        onChange={(v) => {
          const d = LOOKAHEAD_DAYS.find((x) => String(x) === v);
          if (d) onHorizon(d);
        }}
        style={styles.horizon}
        accessibilityLabel="Look-ahead window"
        testID="deliveries-register-horizon"
      />
    </>
  );

  const emptyState = look.upcoming.length === 0 && look.late.length === 0 ? (
    <EmptyState
      icon={truck}
      title="Nothing scheduled yet"
      message="Add what you're expecting and the date it was promised. Anything that slips past its date shows up here and in Waiting On, so a late load gets chased before the crew is stood down."
      actionLabel="Add delivery"
      onAction={onAdd}
    />
  ) : (
    <EmptyState icon={truck} title={`Nothing due in the next ${horizon} days`} message="The late loads above still need chasing." />
  );

  return (
    <RegisterShell
      registerId="deliveries"
      title="Deliveries"
      testID="deliveries-register"
      leadingCrumbs={[{ label: projectName, href: routeHref('/project-detail', { id: projectId }) }]}
      meta={summarizeLookahead(look, horizon)}
      restoreHeaderOnExit={false}
      csvStem={csvStem}
      csv={csv}
      onNew={onAdd}
      actions={[
        { key: 'add', label: 'Add delivery', primary: true, icon: Plus, onPress: onAdd, testID: 'deliveries-register-add' },
        {
          key: 'access', label: hasAccessRules ? 'Building access & bookings' : 'Set up building access',
          icon: Building2, onPress: onOpenBuildingAccess, testID: 'deliveries-register-access',
        },
      ]}
      above={above}
      renderTable={() => (
        <View style={styles.body} testID="deliveries-register-body">
          {lead}
          <DataTable<DeliveryRegisterRow>
            tableId="reg-deliveries-upcoming"
            testID="deliveries-register-table"
            density="compact"
            rows={upcomingRows}
            columns={columns}
            rowKey={(r) => r.id}
            defaultSort={null}
            searchText={(r) => `${r.what} ${r.supplier ?? ''} ${r.po ?? ''}`}
            searchPlaceholder="Search deliveries"
            selectable
            bulkActions={[
              { key: 'confirm', label: 'Confirm', run: confirmSelected },
              { key: 'receive', label: 'Mark received', run: () => {}, disabledReason: DELIVERY_BULK_RECEIVE_REASON },
              { key: 'csv', label: 'Export CSV', run: exportSelected },
            ]}
            emptyState={emptyState}
            renderCard={card}
          />
        </View>
      )}
    />
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  cell: { ...Type.bodyCompact, color: t.text },
  muted: { ...Type.bodyCompact, color: t.textMuted },
  num: { ...Type.bodyCompact, color: t.text, fontVariant: ['tabular-nums'] },
  flag: { ...Type.bodyCompact, fontWeight: '600', fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  body: { gap: Layout.groupGap },
  section: { gap: 8 },
  sectionLabel: { ...Type.monoCaption, letterSpacing: 1, textTransform: 'uppercase' },
  horizon: { alignSelf: 'flex-start' },
});

export default DeliveriesRegister;
