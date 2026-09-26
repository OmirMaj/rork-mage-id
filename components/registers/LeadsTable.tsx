// components/registers/LeadsTable.tsx — the Pipeline as a list (wave 6d, lane
// R3). DESKTOP WEB ONLY: app/leads.tsx renders it inside RegisterShell when
// useIsDesktopWeb() is true and the Board/List switch reads List. The phone
// keeps its board (`grouped[stage].map((l) =>`), untouched.
//
// Rows are the board's own groups flattened in pipeline order (New oldest
// first, the rest most recently updated), so the list and the board agree.
// Every row is a real link to /lead-detail?leadId= — a click opens it in-app,
// Cmd-click in a new tab. There is no split: lead-detail is a full form route
// with its own save bar.
//
// D9: until the leads read has settled (useProjects().leadsLoaded) the table
// says "Loading…", never an empty pipeline.

import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Users } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { DataTable, type DataTableColumn } from '@/components/desktop/DataTable';
import { routeHref } from '@/components/desktop/RowLink';
import FilterChipRow from '@/components/FilterChipRow';
import EmptyState from '@/components/EmptyState';
import { LogCard } from '@/components/logs/LogCard';
import { logDayKey, logDayLabel, logMoney } from '@/utils/logs/logRoutes';
import {
  LEAD_CHIPS, leadChipCounts, leadFirstReplyCell, leadRegisterRow,
  type LeadChip, type LeadRegisterRow,
} from '@/utils/registers/leadRows';
import { LEAD_STAGES, type Lead, type LeadStage } from '@/types';

export interface LeadsTableProps {
  /** The screen's grouped memo (the board's columns). */
  grouped: Readonly<Record<LeadStage, readonly Lead[]>>;
  /** useProjects().leadsLoaded. */
  loaded: boolean;
  /** The board's stage dot colours (app/leads.tsx STAGE_COLORS). */
  stageColors: Readonly<Record<LeadStage, string>>;
  /** Opens a blank lead (the toolbar's Add by hand). */
  onNew: () => void;
}

/** The rows the list shows, in the board's order — exported for the CSV. */
export function leadListRows(grouped: Readonly<Record<LeadStage, readonly Lead[]>>, nowMs: number): LeadRegisterRow[] {
  return LEAD_STAGES.flatMap((s) => grouped[s]).map((l) => leadRegisterRow(l, nowMs));
}

export function LeadsTable({ grouped, loaded, stageColors, onNew }: LeadsTableProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const all = useMemo(() => (loaded ? leadListRows(grouped, Date.now()) : []), [grouped, loaded]);
  const counts = useMemo(() => leadChipCounts(all), [all]);
  const [chip, setChip] = useState<LeadChip>('all');
  const rows = useMemo(() => (chip === 'all' ? all : all.filter((r) => r.stage === chip)), [all, chip]);

  const columns: DataTableColumn<LeadRegisterRow>[] = useMemo(() => {
    const now = new Date();
    return [
      { key: 'name', label: 'Name', flex: 1.6, minWidth: 160, sortValue: (r) => r.name, value: (r) => r.name || null },
      {
        key: 'stage', label: 'Stage', width: 130, sortValue: (r) => r.stageIndex,
        render: (r) => (
          <View style={styles.stageCell}>
            <View style={[styles.dot, { backgroundColor: stageColors[r.stage] }]} />
            <Text style={styles.cell} numberOfLines={1}>{r.stageLabel}</Text>
          </View>
        ),
      },
      {
        key: 'score', label: 'Score', width: 70, numeric: true, sortValue: (r) => r.score,
        render: (r) => <Text style={[styles.num, styles.right]}>{r.score === null ? '—' : String(r.score)}</Text>,
      },
      {
        key: 'budget', label: 'Budget', width: 110, numeric: true, sortValue: (r) => r.budget,
        render: (r) => <Text style={[styles.num, styles.right]} numberOfLines={1}>{logMoney(r.budget) ?? '—'}</Text>,
      },
      {
        key: 'firstReply', label: 'First reply', width: 130,
        sortValue: (r) => (r.waitingHours !== null ? -1 - r.waitingHours : r.firstReplyHours),
        render: (r) => {
          const c = leadFirstReplyCell(r);
          if (!c) return <Text style={styles.muted}>—</Text>;
          const color = c.tone === 'danger' ? t.dangerLabel : c.tone === 'warning' ? t.warningLabel : t.text;
          return <Text style={[styles.num, { color }]} numberOfLines={1}>{c.text}</Text>;
        },
      },
      {
        key: 'received', label: 'Received', width: 100, sortValue: (r) => logDayKey(r.receivedAt),
        value: (r) => logDayLabel(r.receivedAt, now),
      },
      { key: 'projectType', label: 'Project type', flex: 1.2, hideBelow: 900, sortValue: (r) => r.projectType, value: (r) => r.projectType },
      { key: 'source', label: 'Source', width: 120, hideBelow: 1000, sortValue: (r) => r.source, value: (r) => r.source },
      { key: 'phone', label: 'Phone', width: 130, hideBelow: 1100, sortValue: (r) => r.phone, value: (r) => r.phone },
    ];
  }, [styles, stageColors, t.dangerLabel, t.warningLabel, t.text]);

  const icon = <Users size={28} color={t.accent} strokeWidth={1.75} />;
  const emptyState = !loaded ? (
    <EmptyState icon={icon} title="Loading…" message="Your pipeline appears here once it loads." />
  ) : all.length === 0 ? (
    <EmptyState
      icon={icon}
      title="No leads in the pipeline yet"
      message="Capture every inbound — homeowner calls, web inquiries, referrals — so they don't slip past the first 24 hours."
      actionLabel="Add by hand"
      onAction={onNew}
    />
  ) : (
    <EmptyState icon={icon} title="Nothing under this filter" message="Pick another stage, or All." />
  );

  return (
    <DataTable<LeadRegisterRow>
      tableId="reg-leads"
      testID="leads-register-table"
      density="compact"
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      getRowHref={(r) => routeHref('/lead-detail', { leadId: r.id })}
      defaultSort={null}
      searchText={(r) => `${r.name} ${r.projectType ?? ''} ${r.source ?? ''} ${r.phone ?? ''} ${r.email ?? ''}`}
      searchPlaceholder="Search leads"
      filterChips={(
        <FilterChipRow<LeadChip>
          noPadding
          testID="leads-register-chip"
          value={chip}
          onChange={setChip}
          chips={LEAD_CHIPS.map((c) => ({ value: c.key, label: c.label, count: loaded ? counts[c.key] : undefined }))}
        />
      )}
      emptyState={emptyState}
      renderCard={(r) => <LogCard title={r.name || '—'} meta={r.stageLabel} />}
    />
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  cell: { ...Type.bodyCompact, color: t.text, flexShrink: 1 },
  muted: { ...Type.bodyCompact, color: t.textMuted },
  num: { ...Type.bodyCompact, color: t.text, fontVariant: ['tabular-nums'] },
  right: { textAlign: 'right' },
  stageCell: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  dot: { width: 8, height: 8, borderRadius: Tokens.radius.full },
});

export default LeadsTable;
