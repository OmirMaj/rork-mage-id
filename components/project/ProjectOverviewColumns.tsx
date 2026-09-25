// components/project/ProjectOverviewColumns.tsx — Money · Schedule · Field.
//
// Desktop only (app/project-detail.tsx mounts it inside its `isDesktop ?`
// branch). Three short cards a GC reads at a glance instead of opening three
// sections: what money is waiting on him, what starts in the next three weeks,
// and what the field last reported. Every row is a way in — a real link where
// the target is a log on desktop web (Cmd-click opens a new tab), a button
// where it is not.
//
// Honest by construction: Money is LEFT OUT (not zeroed) for a role that may
// not see money or whose access could not be verified; an empty card says why
// it is empty; the row text comes from the pure utils/projectWorkspaceLayout
// helpers, which the bun validator runs.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Href } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { TileGrid } from '@/components/ui/TileGrid';
import { cardSurface } from '@/components/ui/Card';
import { RowLink } from '@/components/desktop/RowLink';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import {
  NO_SCHEDULE_REASON,
  arRowText,
  committedRowText,
  finishLabel,
  lastReportRowText,
  listSectionRoute,
  lookaheadRowText,
  pendingCORowText,
  punchRowText,
  workspaceHref,
  type LogSectionKey,
  type ProjectPulse,
} from '@/utils/projectWorkspaceLayout';

/** At most this many rows under a card header. */
const MAX_ROWS = 6;

export interface ProjectOverviewColumnsProps {
  projectId: string;
  pulse: ProjectPulse;
  /** Desktop web: rows into a log are links. Elsewhere they open in place. */
  listLinks: boolean;
  onOpenSection: (key: LogSectionKey) => void;
  /** The schedule — the existing router.replace to the schedule tab with the
   *  focus nonce (a bare link would reopen whichever job it last showed). */
  onOpenSchedule: () => void;
  /** No schedule yet → the schedule builder (the quick action's own route). */
  onBuildSchedule: () => void;
}

type Target = { href: Href } | { onPress: () => void } | null;

interface Row {
  key: string;
  text: string;
  target: Target;
  tag?: string;
  tone?: 'muted' | 'warn';
}

export function ProjectOverviewColumns({
  projectId, pulse, listLinks, onOpenSection, onOpenSchedule, onBuildSchedule,
}: ProjectOverviewColumnsProps) {
  const styles = useThemedStyles(makeStyles);
  const showMoney = pulse.canSeeMoney && !pulse.roleError;

  // A log section with no log screen yet (not in LIST_SECTION_ROUTES) opens
  // in place on desktop web too.
  const toList = (key: LogSectionKey, extra?: Record<string, string>): Target => {
    const route = listSectionRoute(key);
    return listLinks && route
      ? { href: workspaceHref(route, { projectId, ...extra }) }
      : { onPress: () => onOpenSection(key) };
  };

  // ── Money ──
  const moneyRows: Row[] = [];
  if (showMoney) {
    for (const co of pulse.pendingCOs.slice(0, 3)) {
      moneyRows.push({ key: `co-${co.id}`, text: pendingCORowText(co), target: toList('changeOrders', { coId: co.id }) });
    }
    if (pulse.pendingCOs.length === 0) {
      moneyRows.push({ key: 'co-none', text: 'No change orders waiting', target: toList('changeOrders'), tone: 'muted' });
    }
    moneyRows.push(pulse.ar
      ? { key: 'ar', text: arRowText(pulse.ar), target: toList('invoices') }
      : { key: 'ar', text: 'A/R: no invoices sent yet', target: toList('invoices'), tone: 'muted' });
    const committed = committedRowText(pulse.committed);
    if (committed) {
      moneyRows.push({ key: 'committed', text: committed, target: { href: workspaceHref('/buyout', { projectId }) } });
    }
  }

  // ── Schedule ──
  const scheduleRows: Row[] = [];
  const la = pulse.lookahead;
  if (la.reason === NO_SCHEDULE_REASON) {
    scheduleRows.push({ key: 'build', text: 'No schedule yet — Build schedule', target: { onPress: onBuildSchedule } });
  } else {
    for (const r of la.rows) {
      scheduleRows.push({
        key: `task-${r.id}`,
        text: lookaheadRowText(r),
        target: { onPress: onOpenSchedule },
        tag: r.isCriticalPath ? 'Critical' : undefined,
      });
    }
    if (la.rows.length === 0) {
      scheduleRows.push({ key: 'empty', text: la.reason, target: { onPress: onOpenSchedule }, tone: 'muted' });
    }
    const finish = finishLabel(pulse.forecastFinish);
    if (finish) scheduleRows.push({ key: 'finish', text: `Forecast finish ${finish}`, target: { onPress: onOpenSchedule } });
  }

  // ── Field ──
  const fieldRows: Row[] = [
    {
      key: 'report',
      text: lastReportRowText(pulse.lastDailyReport),
      target: toList('dailyReports'),
      tone: pulse.lastDailyReport ? undefined : 'muted',
    },
    { key: 'punch', text: punchRowText(pulse.punch), target: toList('punchList') },
    {
      key: 'rfis',
      text: `RFIs past due: ${pulse.overdueRfis}`,
      target: toList('rfis'),
      tone: pulse.overdueRfis > 0 ? 'warn' : undefined,
    },
  ];

  return (
    <TileGrid preset="content" testID="project-overview-columns">
      {showMoney ? (
        <OverviewCard
          title="Money"
          viewAll={toList('changeOrders')}
          rows={moneyRows}
          styles={styles}
          testID="overview-money"
        />
      ) : null}
      <OverviewCard
        title="Schedule · next 21 days"
        viewAll={la.reason === NO_SCHEDULE_REASON ? null : { onPress: onOpenSchedule }}
        rows={scheduleRows}
        styles={styles}
        testID="overview-schedule"
      />
      <OverviewCard
        title="Field"
        viewAll={toList('dailyReports')}
        rows={fieldRows}
        styles={styles}
        testID="overview-field"
      />
    </TileGrid>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function OverviewCard({ title, viewAll, rows, styles, testID, style }: {
  title: string;
  viewAll: Target;
  rows: Row[];
  styles: Styles;
  testID: string;
  /** TileGrid appends the column width here. */
  style?: object;
}) {
  return (
    <View style={[styles.card, style]} testID={testID}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">{title}</Text>
        {viewAll ? (
          <TargetSurface target={viewAll} style={styles.viewAll} label={`View all: ${title}`} testID={`${testID}-view-all`}>
            <Text style={styles.viewAllText}>View all</Text>
          </TargetSurface>
        ) : null}
      </View>
      {rows.slice(0, MAX_ROWS).map((r) => (
        <TargetSurface key={r.key} target={r.target} style={styles.row} label={r.tag ? `${r.text}, ${r.tag}` : r.text} testID={`${testID}-${r.key}`}>
          <Text style={[styles.rowText, r.tone === 'muted' && styles.rowMuted, r.tone === 'warn' && styles.rowWarn]} numberOfLines={1}>
            {r.text}
          </Text>
          {r.tag ? (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{r.tag}</Text>
            </View>
          ) : null}
          {r.target ? <RowChevron /> : null}
        </TargetSurface>
      ))}
    </View>
  );
}

function RowChevron() {
  const { colors: t } = useTheme();
  return <ChevronRight {...Tokens.iconSize.small} color={t.textMuted} />;
}

/** A link where the row has an href, a button where it has an action, text
 *  where it has neither. */
function TargetSurface({ target, style, label, testID, children }: {
  target: Target;
  style: object;
  label: string;
  testID: string;
  children: React.ReactNode;
}) {
  const { colors: t } = useTheme();
  if (target && 'href' in target) {
    return (
      <RowLink href={target.href} style={style} accessibilityLabel={label} testID={testID}>
        {children}
      </RowLink>
    );
  }
  if (target && 'onPress' in target) {
    return (
      <Pressable
        onPress={target.onPress}
        style={(s: { hovered?: boolean }) => [style, s.hovered ? { backgroundColor: t.surfaceAlt } : null]}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={testID}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={style} accessibilityLabel={label} testID={testID}>{children}</View>;
}

const ROW_H = 32;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: { ...cardSurface(t, { pad: 12 }) },
  header: { height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { ...Type.subheadEmphasized, color: t.text, flexShrink: 1 },
  viewAll: { marginLeft: 'auto', height: ROW_H, justifyContent: 'center', paddingHorizontal: 8, borderRadius: Tokens.radius.sm },
  viewAllText: { ...Type.footnoteEmphasized, color: t.accentLabel },
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    borderRadius: Tokens.radius.sm,
  },
  rowText: { ...Type.footnote, color: t.text, flexShrink: 1, fontVariant: ['tabular-nums'] },
  rowMuted: { color: t.textMuted },
  rowWarn: { color: t.warningLabel },
  tag: { paddingHorizontal: 6, height: 18, justifyContent: 'center', borderRadius: Tokens.radius.sm, backgroundColor: t.dangerLabel },
  tagText: { ...Type.caption2, fontWeight: '700', color: t.surface },
});

export default ProjectOverviewColumns;
