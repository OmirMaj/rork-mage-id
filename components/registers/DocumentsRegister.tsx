// components/registers/DocumentsRegister.tsx — every COI, permit, submittal
// and AIA pay app as one table of LINKS (wave 6d, lane R3). DESKTOP WEB ONLY:
// app/documents.tsx renders it only when useIsDesktopWeb() is true; the phone
// keeps its cards (`filtered.map(doc =>`), untouched.
//
// Documents is a read-only aggregator: each record lives on its own screen, so
// a row is a real link there (utils/registers/documentRows documentRoute) — a
// click opens it in-app, Cmd-click in a new tab. A COI row opens THAT sub's
// certificates beside the vault list (/coi-vault?subId=…); a submittal row
// opens the submittal log's split. The rows, statuses, buckets and counts are
// the phone screen's own memos, passed in.
//
// The audit's Folder / By / Size columns are NOT built: none of the four
// aggregated kinds carries that data, and a column of dashes is not a column.
// His uploaded files stay one click away in the Project files rail.

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, FileText, FolderOpen } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { DataTable, type DataTableColumn } from '@/components/desktop/DataTable';
import { KpiStrip, type KpiCell } from '@/components/desktop/KpiStrip';
import { RowLink, routeHref } from '@/components/desktop/RowLink';
import FilterChipRow from '@/components/FilterChipRow';
import EmptyState from '@/components/EmptyState';
import { Card } from '@/components/ui';
import { StatusPill, type StatusTone } from '@/components/ui/StatusPill';
import { LogCard } from '@/components/logs/LogCard';
import { RegisterShell } from '@/components/registers/RegisterShell';
import { rowsToCsv } from '@/utils/dataTable';
import { logDayKey, logDayLabel } from '@/utils/logs/logRoutes';
import {
  DOCUMENT_CHIPS, DOCUMENT_CSV_COLUMNS, documentChipCounts, documentChipMatches, documentExpiringSoon,
  documentRoute, documentTypeLabel,
  type DocumentChip, type DocumentRegisterRow, type DocumentTone,
} from '@/utils/registers/documentRows';
import type { CertificateOfInsurance, SavedAIAPayApp } from '@/types';

/** The page's one-line sub-copy. No contracts: they are not in this feed. */
export const DOCUMENTS_REGISTER_META = 'Your COIs, permits, submittals and AIA pay apps across your projects — in one feed. Click a row to open it where it lives.';

const STATUS_TONE: Readonly<Record<DocumentTone, StatusTone>> = {
  danger: 'error',
  warning: 'warning',
  success: 'success',
  neutral: 'neutral',
  muted: 'neutral',
};

/** The screen's stats memo. */
export interface DocumentStats {
  total: number;
  pending: number;
  done: number;
  expired: number;
  coiFailed: number;
  coiReview: number;
  expiringSoon: number;
}

export interface DocumentsRegisterProps {
  documents: readonly DocumentRegisterRow[];
  stats: DocumentStats;
  /** The screen's chip ('all' or a bucket) — shared with the phone arm. */
  selectedFilter: string;
  setSelectedFilter: (id: string) => void;
  /** Open jobs whose Files the rail links to (the screen's fileProjects). */
  fileProjects: readonly { id: string; name: string }[];
  cois: readonly Pick<CertificateOfInsurance, 'id' | 'subcontractorId'>[];
  aiaPayApps: readonly Pick<SavedAIAPayApp, 'id' | 'invoiceId'>[];
}

export function DocumentsRegister({
  documents, stats, selectedFilter, setSelectedFilter, fileProjects, cois, aiaPayApps,
}: DocumentsRegisterProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  const chip: DocumentChip = DOCUMENT_CHIPS.find((c) => c.key === selectedFilter)?.key ?? 'all';
  const counts = useMemo(() => documentChipCounts(documents), [documents]);
  const rows = useMemo(() => documents.filter((d) => documentChipMatches(d, chip)), [documents, chip]);

  const cells = useMemo<KpiCell[]>(() => {
    const out: KpiCell[] = [
      { key: 'total', label: 'Total', value: stats.total },
      { key: 'waiting', label: 'Waiting', value: stats.pending, tone: stats.pending > 0 ? 'warn' : undefined },
      { key: 'done', label: 'Done', value: stats.done, tone: 'good' },
      { key: 'expired', label: 'Expired', value: stats.expired, tone: stats.expired > 0 ? 'bad' : undefined },
      { key: 'expiring', label: 'Expiring ≤30 d', value: stats.expiringSoon, tone: stats.expiringSoon > 0 ? 'warn' : undefined },
    ];
    const risk = stats.coiFailed + stats.coiReview;
    if (risk > 0) {
      out.push({ key: 'coi', label: 'COI at risk', value: risk, tone: 'bad', href: routeHref('/coi-vault'), testID: 'documents-register-coi-risk' });
    }
    return out;
  }, [stats]);

  const columns: DataTableColumn<DocumentRegisterRow>[] = useMemo(() => {
    const now = new Date();
    const nowMs = now.getTime();
    return [
      { key: 'type', label: 'Type', width: 120, sortValue: (d) => documentTypeLabel(d), value: (d) => documentTypeLabel(d) },
      { key: 'title', label: 'Title', flex: 2, minWidth: 200, sortValue: (d) => d.title, value: (d) => d.title || null },
      {
        key: 'status', label: 'Status', width: 160, sortValue: (d) => d.status.label,
        render: (d) => <StatusPill label={d.status.label} tone={STATUS_TONE[d.status.tone]} size="compact" />,
      },
      {
        key: 'date', label: 'Date', width: 100, sortValue: (d) => logDayKey(d.createdAt),
        render: (d) => <Text style={styles.num} numberOfLines={1}>{logDayLabel(d.createdAt, now) ?? '—'}</Text>,
      },
      {
        key: 'expires', label: 'Expires', width: 120, hideBelow: 640, sortValue: (d) => logDayKey(d.expiresAt),
        render: (d) => {
          const label = logDayLabel(d.expiresAt, now);
          if (!label) return <Text style={styles.muted}>—</Text>;
          return (
            <Text style={[styles.num, documentExpiringSoon(d, nowMs) && { color: t.warningLabel }]} numberOfLines={1}>{label}</Text>
          );
        },
      },
      { key: 'project', label: 'Project', flex: 1.2, hideBelow: 760, sortValue: (d) => d.projectName, value: (d) => d.projectName || null },
    ];
  }, [styles, t.warningLabel]);

  const csv = () => rowsToCsv(DOCUMENT_CSV_COLUMNS, rows);
  const icon = <FileText size={28} color={t.accent} strokeWidth={1.75} />;
  const chipLabel = DOCUMENT_CHIPS.find((c) => c.key === chip)?.label ?? chip;
  const emptyState = documents.length === 0 ? (
    <EmptyState
      icon={icon}
      title="Nothing filed yet"
      message="This screen collects documents — it does not create them. Each kind is filed on its own screen and shows up here automatically."
      steps={[
        'COIs: add a subcontractor certificate in the COI Vault.',
        'Permits: log an application on the Permits screen.',
        'Submittals and pay apps: open a project — both are filed inside one.',
      ]}
      actionLabel="Open COI Vault"
      onAction={() => router.push(routeHref('/coi-vault'))}
      secondaryLabel="Open Permits"
      onSecondaryAction={() => router.push(routeHref('/permits'))}
    />
  ) : (
    <EmptyState
      icon={icon}
      title="Nothing under this filter"
      message={`You have ${documents.length} document${documents.length === 1 ? '' : 's'}, but none are filed under "${chipLabel}". Nothing is missing — this is the filter, not the feed.`}
      actionLabel="Show all"
      onAction={() => setSelectedFilter('all')}
    />
  );

  const aside = fileProjects.length > 0 ? (
    <Card testID="documents-register-files">
      <View style={styles.filesHead}>
        <FolderOpen size={16} color={t.accent} strokeWidth={1.75} />
        <Text style={styles.filesHeading}>Uploaded files and scans</Text>
      </View>
      <Text style={styles.filesBody}>
        Files you upload and documents Scan Anything files are kept in each project&apos;s Files, not in this feed.
      </Text>
      <View style={styles.filesList}>
        {fileProjects.map((p) => (
          <RowLink
            key={p.id}
            href={routeHref('/project-files', { projectId: p.id })}
            style={styles.filesRow}
            accessibilityLabel={`Open files for ${p.name}`}
            testID={`documents-register-files-${p.id}`}
          >
            <Text style={styles.filesRowText} numberOfLines={1}>{p.name}</Text>
            <ChevronRight size={16} color={t.textMuted} strokeWidth={1.75} />
          </RowLink>
        ))}
      </View>
    </Card>
  ) : undefined;

  return (
    <RegisterShell
      registerId="documents"
      title="Documents"
      testID="documents-register"
      meta={DOCUMENTS_REGISTER_META}
      csvStem="documents"
      csv={csv}
      actions={[]}
      above={<KpiStrip cells={cells} testID="documents-register-kpis" />}
      aside={aside}
      renderTable={() => (
        <DataTable<DocumentRegisterRow>
          tableId="reg-documents"
          testID="documents-register-table"
          density="compact"
          rows={rows}
          columns={columns}
          rowKey={(d) => d.id}
          getRowHref={(d) => {
            const r = documentRoute(d, cois, aiaPayApps);
            return routeHref(r.pathname, r.params);
          }}
          defaultSort={null}
          searchText={(d) => `${d.title} ${d.projectName} ${d.status.label} ${d.notes ?? ''}`}
          searchPlaceholder="Search documents"
          filterChips={(
            <FilterChipRow<DocumentChip>
              noPadding
              testID="documents-register-chip"
              value={chip}
              onChange={setSelectedFilter}
              chips={DOCUMENT_CHIPS.map((c) => ({ value: c.key, label: c.label, count: counts[c.key] }))}
            />
          )}
          emptyState={emptyState}
          renderCard={(d) => <LogCard title={d.title} meta={d.status.label} />}
        />
      )}
    />
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  num: { ...Type.bodyCompact, color: t.text, fontVariant: ['tabular-nums'] },
  muted: { ...Type.bodyCompact, color: t.textMuted },
  filesHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  filesHeading: { ...Type.subhead, fontWeight: '700', color: t.text },
  filesBody: { ...Type.footnote, color: t.textSecondary, marginTop: 6 },
  filesList: { marginTop: 10 },
  filesRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 6, borderRadius: Tokens.radius.xs },
  filesRowText: { ...Type.bodyCompact, flex: 1, color: t.text },
});

export default DocumentsRegister;
