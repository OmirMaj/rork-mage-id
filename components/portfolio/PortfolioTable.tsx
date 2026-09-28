// components/portfolio/PortfolioTable.tsx — the desktop Home's job table.
//
// WHY (wave 6c, lane F). At 1512 × 945 the desktop Home was 1.8 screens tall
// and its project list rendered AFTER twelve full-width cards, as the tablet's
// ProjectRow stack — 'Area', 'Quality', 'Burn', 'Estimate' — with rows that
// reshuffled on every save. This is the 6b DataTable over
// utils/portfolio/portfolioRow: sortable (default: worst schedule first, then
// earliest finish), searchable, 40 px rows, a sticky header, columns that hide
// by the TABLE's measured width (PORTFOLIO_HIDE_BELOW: each threshold is the
// cumulative fit, so Job keeps its 160 px at every width — DataTable's row
// does not clip on web, and a too-wide row would spill past the card), and every row a real link to the job
// (Cmd-click opens a tab; there is no onRowOpen, so a plain click navigates
// in-app). Sort and hidden columns persist in `mageid_table_portfolio`
// (mageid_ prefix → swept on sign-out / tenant switch).
//
// PHONE / TABLET: DataTable returns `rows.map(renderCard)` below the desktop
// gate, and renderCard is the ProjectRow for that job — Home never mounts this
// below the gate (the phone keeps its FlatList of ProjectCards, the tablet its
// ProjectRow table), but the contract holds if anyone does.
//
// Honesty: every unknown cell is '—' (DataTable's UNKNOWN_CELL rule, and this
// file's own renders); money cells come only from the burn map, whose
// visibility rule leaves out jobs someone else owns.
//
// HEALTH (ideas-1, T5; `showLevel`, default false). An optional narrow column
// with The Level as a reading per project (components/level/JobLevel): the
// bubble drifts with schedule slip against the baseline, the tint is margin
// risk, and "Not enough data yet" when neither is known. Its margin half obeys
// the same burn-map visibility rule as the money columns. Its width and
// hideBelow live in utils/jobLevel (JOB_LEVEL_COLUMN_*), budgeted on top of
// PORTFOLIO_HIDE_BELOW so Job keeps its 160 px at every width
// (scripts/validate-job-level.ts sweeps it). With showLevel false the table
// renders exactly as before: the Level's hooks live in a wrapper that is not
// mounted then.

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { MoreHorizontal } from 'lucide-react-native';
import type { Project } from '@/types';
import { DataTable, type DataTableColumn } from '@/components/desktop/DataTable';
import { routeHref } from '@/components/desktop/RowLink';
import ProjectRow from '@/components/ProjectRow';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { formatMoneyShort } from '@/utils/formatters';
import { parseCalendarDay } from '@/utils/calendarDate';
import { AnimatedFill } from '@/components/animations/AnimatedFill';
import { JobLevel } from '@/components/level/JobLevel';
import { useJobLevels } from '@/hooks/useJobLevel';
import {
  JOB_LEVEL_COLUMN_HIDE_BELOW, JOB_LEVEL_COLUMN_ID, JOB_LEVEL_COLUMN_WIDTH, jobLevelSortValue,
  type JobLevelReading,
} from '@/utils/jobLevel';
import {
  formatOpenItems, relativeDaysLabel, scheduleCellDescription, scheduleCellLabel,
  PORTFOLIO_COLUMN_WIDTHS as W, PORTFOLIO_HIDE_BELOW as HIDE,
  type BurnEntry, type PortfolioRow,
} from '@/utils/portfolio/portfolioRow';

const UNKNOWN = '—';

/**
 * The basis of the Contract and Billed columns, said under the table.
 *
 * ACCEPTED DEVIATION (wave 6c integration, round 1). The job page's Contract
 * and Billed KPIs prefer a SIGNED contract's price (resolveContractSum,
 * MONEY-CONTRACT-1); Home reads no project_contracts, so its revised contract
 * is buildBurnByProject's estimate + approved change orders. The billed-% RULE
 * is the job page's own (portfolioRow.billedPercent → billedPct, uncapped), so
 * the two screens agree on every job with no signed contract, or one signed at
 * its estimate; a job signed at a negotiated price can differ, and this line
 * says which number Home is printing rather than letting it pass as the
 * contract. Closing it needs one bulk signed-contract read on Home feeding
 * buildBurnByProject (and the #151 guard in validate-w5-home-screen updated).
 */
export const CONTRACT_BASIS_NOTE = 'Contract and Billed use the estimate plus approved change orders. A signed contract\'s price shows on the job page.';

/** The stage dot's colour, by status — the same tones ProjectRow and
 *  ProjectCard give their badges (draft/completed warn, estimated success,
 *  in progress info, closed neutral), so a job reads the same colour on every
 *  surface. The stage is a dot + sentence-case word, not a <Badge>: the
 *  badge's mono uppercase 'CONSTRUCTION' pill is ~116 px and spilled out of
 *  the column; 'Construction' in footnote fits (validate-portfolio-row pins
 *  the longest stage word against PORTFOLIO_COLUMN_WIDTHS.stage). */
function stageDotColor(t: ThemeColors, status: string): string {
  switch (status) {
    case 'estimated': return t.success;
    case 'in_progress': return t.info;
    case 'draft':
    case 'completed': return t.accent;
    default: return t.textMuted;
  }
}

function shortDate(iso: string | null): string {
  const d = parseCalendarDay(iso);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : UNKNOWN;
}

export interface PortfolioTableProps {
  /** The jobs in the current stage bucket (already filtered). */
  projects: readonly Project[];
  /** buildPortfolioRows over the same jobs. */
  rows: readonly PortfolioRow[];
  /** Home's burn map — passed through to the phone card (ProjectRow). */
  burnByProject: ReadonlyMap<string, BurnEntry>;
  /** The stage SegmentedControl, drawn in the table's toolbar. */
  stageChips?: React.ReactNode;
  /** The ⋯ button: Home's EntityActionSheet (Duplicate). */
  /** The ⋯ press passes its window point so the desktop action menu opens as
   *  a popover there (EntityActionSheet's `anchor`); a long press passes none
   *  and gets the centred sheet. */
  onOpenActions: (project: Project, anchor?: { x: number; y: number }) => void;
  /** The phone card's tap (never used on desktop — the row is a link). */
  onOpenProject: (project: Project) => void;
  /** The just-created job, highlighted. */
  highlightId?: string | null;
  /** The empty-bucket state ('No {label} jobs' + 'Show all jobs'). */
  emptyState?: React.ReactNode;
  /** "Now" for 'Last activity'; injectable for tests. */
  now?: Date;
  /** Adds the Health column (The Level as a reading). Default false. */
  showLevel?: boolean;
  testID?: string;
}

/** The Health column's readings, read once for the table (only when shown). */
function PortfolioTableWithLevel(props: PortfolioTableProps) {
  const { rows, projects, burnByProject, now } = props;
  // The rows' own schedule verdicts: the Level reads the slip the Schedule
  // column prints, never a second derivation.
  const schedules = useMemo(() => new Map(rows.map((r) => [r.id, r.schedule] as const)), [rows]);
  const levels = useJobLevels({ projects, schedules, marginVisible: burnByProject, now });
  return <PortfolioTableBase {...props} levels={levels} />;
}

export function PortfolioTable(props: PortfolioTableProps) {
  if (props.showLevel) return <PortfolioTableWithLevel {...props} />;
  return <PortfolioTableBase {...props} levels={null} />;
}

function PortfolioTableBase({
  projects, rows, burnByProject, stageChips, onOpenActions, onOpenProject, highlightId = null, emptyState, now, testID = 'portfolio-table', levels,
}: PortfolioTableProps & { levels: ReadonlyMap<string, JobLevelReading> | null }) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const clock = now ?? new Date();

  // The optional Health column (showLevel). Keyed and sized from
  // utils/jobLevel, not PORTFOLIO_COLUMN_WIDTHS: it is not a spec column.
  const levelColumns = useMemo<DataTableColumn<PortfolioRow>[]>(() => (levels ? [{
    key: JOB_LEVEL_COLUMN_ID,
    label: 'Health',
    width: JOB_LEVEL_COLUMN_WIDTH,
    hideBelow: JOB_LEVEL_COLUMN_HIDE_BELOW,
    align: 'center',
    sortValue: (r) => jobLevelSortValue(levels.get(r.id)),
    render: (r) => {
      const reading = levels.get(r.id);
      return reading
        ? <JobLevel projectId={r.id} reading={reading} size="row" showLabel={false} projectName={r.name} />
        : <Text style={styles.cell}>{UNKNOWN}</Text>;
    },
  }] : []), [levels, styles]);

  const columns = useMemo<DataTableColumn<PortfolioRow>[]>(() => [
    {
      key: 'job',
      label: 'Job',
      flex: 1,
      minWidth: W.jobMin,
      sortValue: (r) => r.name.toLowerCase(),
      render: (r) => (
        <View style={styles.jobCell}>
          <Text style={styles.jobName} numberOfLines={1}>{r.name}</Text>
          {r.city ? <Text style={styles.caption} numberOfLines={1}>{r.city}</Text> : null}
        </View>
      ),
    },
    {
      key: 'stage',
      label: 'Stage',
      width: W.stage,
      sortValue: (r) => ['precon', 'construction', 'postcon', 'closeout'].indexOf(r.stage),
      render: (r) => (
        <View style={styles.stageCell}>
          <View style={[styles.stageDot, { backgroundColor: stageDotColor(t, r.status) }]} />
          <Text style={styles.cell} numberOfLines={1}>{r.stageLabel}</Text>
        </View>
      ),
    },
    {
      key: 'pct',
      label: '%',
      width: W.pct,
      numeric: true,
      hideBelow: HIDE.pct,
      sortValue: (r) => r.pct,
      render: (r) => {
        if (r.pct == null) return <Text style={[styles.cell, styles.numeric]}>{UNKNOWN}</Text>;
        const pct = Math.max(0, Math.min(100, r.pct));
        return (
          <View style={styles.pctCell}>
            <Text style={[styles.cell, styles.numeric]}>{r.pct}%</Text>
            <View style={styles.pctTrack}>
              <AnimatedFill value={pct} style={[styles.pctFill, { width: `${pct}%` }]} />
            </View>
          </View>
        );
      },
    },
    {
      key: 'schedule',
      label: 'Schedule',
      width: W.schedule,
      sortValue: (r) => r.scheduleSortValue,
      render: (r) => {
        const s = r.schedule;
        const ink = s && s !== 'undated'
          ? (s.status === 'late' ? t.dangerLabel : s.status === 'at_risk' ? t.warningLabel : t.successLabel)
          : t.textSecondary;
        return (
          <Text style={[styles.cell, { color: ink }]} numberOfLines={1} accessibilityLabel={scheduleCellDescription(s)}>
            {scheduleCellLabel(s)}
          </Text>
        );
      },
    },
    ...levelColumns,
    {
      key: 'finish',
      label: 'Finish',
      width: W.finish,
      sortValue: (r) => r.finishISO,
      render: (r) => <Text style={styles.cell} numberOfLines={1}>{shortDate(r.finishISO)}</Text>,
    },
    {
      key: 'contract',
      label: 'Contract',
      width: W.contract,
      numeric: true,
      hideBelow: HIDE.contract,
      sortValue: (r) => r.contract,
      render: (r) => <Text style={[styles.cell, styles.numeric]} numberOfLines={1}>{r.contract == null ? UNKNOWN : formatMoneyShort(r.contract)}</Text>,
    },
    {
      key: 'billed',
      label: 'Billed',
      width: W.billed,
      numeric: true,
      hideBelow: HIDE.billed,
      sortValue: (r) => r.billedPct,
      render: (r) => <Text style={[styles.cell, styles.numeric]} numberOfLines={1}>{r.billedPct == null ? UNKNOWN : `${r.billedPct}%`}</Text>,
    },
    {
      key: 'ar',
      label: 'A/R',
      width: W.ar,
      numeric: true,
      sortValue: (r) => r.ar,
      render: (r) => (
        <Text
          style={[styles.cell, styles.numeric, r.arOver30 && { color: t.danger }]}
          numberOfLines={1}
          accessibilityLabel={r.ar == null ? 'A/R unknown' : `A/R ${formatMoneyShort(r.ar)}${r.arOver30 ? ', over 30 days past due' : ''}`}
        >
          {r.ar == null ? UNKNOWN : formatMoneyShort(r.ar)}
        </Text>
      ),
    },
    {
      key: 'open',
      label: 'Open',
      width: W.open,
      hideBelow: HIDE.open,
      sortValue: (r) => r.open.rfi + r.open.co + r.open.punch,
      render: (r) => <Text style={styles.cell} numberOfLines={1}>{formatOpenItems(r.open)}</Text>,
    },
    {
      key: 'milestone',
      label: 'Next milestone',
      width: W.milestone,
      hideBelow: HIDE.milestone,
      sortValue: (r) => r.nextMilestone?.dateISO ?? null,
      render: (r) => (r.nextMilestone ? (
        <View style={styles.jobCell}>
          <Text style={styles.cell} numberOfLines={1}>{r.nextMilestone.title}</Text>
          <Text style={styles.caption} numberOfLines={1}>{r.nextMilestone.dateISO ? shortDate(r.nextMilestone.dateISO) : 'No start date'}</Text>
        </View>
      ) : <Text style={styles.cell}>{UNKNOWN}</Text>),
    },
    {
      key: 'activity',
      label: 'Last activity',
      width: W.activity,
      hideBelow: HIDE.activity,
      sortValue: (r) => r.lastActivityISO,
      render: (r) => <Text style={styles.cell} numberOfLines={1}>{relativeDaysLabel(r.lastActivityISO, clock)}</Text>,
    },
    {
      key: 'actions',
      label: '',
      width: W.actions,
      align: 'center',
      render: (r) => {
        const p = byId.get(r.id);
        return (
          <Pressable
            onPress={(e: GestureResponderEvent) => {
              // The row is an <a> on web: this click must not also open the job.
              const ev = e as unknown as { preventDefault?: () => void; stopPropagation?: () => void };
              ev.preventDefault?.();
              ev.stopPropagation?.();
              if (p) onOpenActions(p, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
            }}
            style={(state) => [styles.moreBtn, (state as { hovered?: boolean }).hovered && { backgroundColor: t.surfaceAlt }]}
            accessibilityRole="button"
            accessibilityLabel={`Actions for ${r.name}`}
            hitSlop={4}
            testID={`${testID}-actions-${r.id}`}
          >
            <MoreHorizontal {...Tokens.iconSize.small} color={t.textSecondary} />
          </Pressable>
        );
      },
    },
  // `clock` changes every render; the only column that reads it is Last
  // activity, and a day-granular label does not need to re-derive columns.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [styles, t, byId, onOpenActions, testID, levelColumns]);

  const anyContract = rows.some((r) => r.contract != null);
  // The note belongs to the desktop table; below the gate DataTable returns
  // the ProjectRow cards alone and so does this component (phone identical).
  const { isDesktop } = useResponsiveLayout();

  return (
    <>
    <DataTable<PortfolioRow>
      tableId="portfolio"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      getRowHref={(r) => routeHref('/project-detail', { id: r.id })}
      defaultSort={{ key: 'schedule', dir: 'asc' }}
      searchText={(r) => `${r.name} ${r.city ?? ''}`}
      searchPlaceholder="Search jobs"
      filterChips={stageChips}
      density="comfortable"
      activeKey={highlightId}
      emptyState={emptyState}
      testID={testID}
      renderCard={(r, i) => {
        const p = byId.get(r.id);
        if (!p) return null;
        return (
          <ProjectRow
            project={p}
            invoicedToDate={burnByProject.get(p.id)?.invoicedToDate}
            revisedContract={burnByProject.get(p.id)?.revisedContract}
            showDivider={i < rows.length - 1}
            onPress={() => onOpenProject(p)}
            onLongPress={() => onOpenActions(p)}
          />
        );
      }}
    />
    {isDesktop && anyContract ? (
      <Text style={[styles.caption, styles.basisNote]} testID={`${testID}-contract-basis`}>{CONTRACT_BASIS_NOTE}</Text>
    ) : null}
    </>
  );
}

export default PortfolioTable;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  jobCell: { flex: 1, minWidth: 0, justifyContent: 'center' },
  jobName: { ...Type.body, fontWeight: '700', color: t.text },
  caption: { ...Type.caption1, color: t.textSecondary },
  basisNote: { marginTop: 8 },
  cell: { ...Type.footnote, color: t.text },
  numeric: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  stageCell: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  stageDot: { width: 6, height: 6, borderRadius: Tokens.radius.full, flexShrink: 0 },
  pctCell: { alignItems: 'flex-end', gap: 3, width: '100%' },
  pctTrack: { width: '100%', height: 3, borderRadius: Tokens.radius.full, backgroundColor: t.line, overflow: 'hidden' },
  pctFill: { height: 3, borderRadius: Tokens.radius.full, backgroundColor: t.accent },
  moreBtn: {
    width: 28,
    height: 28,
    borderRadius: Tokens.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
