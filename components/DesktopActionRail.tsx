// ============================================================================
// components/DesktopActionRail.tsx
//
// Right-rail "Action Required" column shown next to the main content at very
// wide desktop widths (>= 1280px). Mirrors the SaaS-dashboard reference layout
// the user shared — sidebar / main / rail — so the eye flows: where am I →
// what am I looking at → what needs me right now.
//
// Data source is useBrainWatch() — THE canonical "needs your attention" set.
// This is the SAME hook + count the Your-Projects tab badge, the Summary NEEDS
// YOU card, and the home Brain Watch card use, so the rail can never disagree
// with the badge mounted beside it (sim-audit #15 "1 vs 11" — the rail used to
// run its own useSmartInbox() row count under an authoritative-sounding
// "Action Required" title while the badge showed the canonical total). The
// dismissible Smart Inbox feed lives in the home "Inbox" card, not here.
//
// Width gate: 1280px MAIN VIEWPORT (not content width). Below that, the rail
// is dropped entirely and the inline Inbox card takes over. This keeps narrow
// laptops (1024-1280) from getting cramped 3-column layouts.
//
// WHY THE EMPTY STATE IS SCOPED (polish audit 2026-09-10, the all-clear wave).
// "All caught up / Nothing urgent across your projects." is a claim about every
// project, made from nine attention kinds that contain no RFI and no submittal
// category. On the audited account that sentence rendered while an RFI sat 23
// days past due to the architect — and it is WORSE here than on the phone,
// because above 1280px app/(tabs)/(home)/index.tsx suppresses the inline Smart
// Inbox in favour of this rail, so the desktop reader has nowhere else on the
// screen to see the row that contradicts it.
//
// The fix keeps this file's original rule intact: the COUNT PILL and the ROWS
// are still only the canonical set (that is sim-audit #15 — the rail once ran
// its own useSmartInbox count under an authoritative "Action Required" title
// while the badge beside it showed a different number). Only the sentence
// changes, and the extra categories gate it rather than joining it.
//
// WAVE 6c (lane F) — THE ONE ATTENTION LIST. At 1512 px Home drew this list
// twice (the rail AND the Brain Watch card) and '+N more' was plain text that
// went nowhere. Now, while the rail is up (utils/sidebarRail actionRailVisible,
// which Home reads too), Home leaves Brain Watch, Ready to Bill, the daily-log
// card and the warranty banner OUT, and the rail carries them:
//   • the canonical rows (still the first 8) and 'See all N' — a real link to
//     /attention (Cmd-click opens a tab);
//   • three sections below — READY TO BILL, DAILY-LOG GAPS, WARRANTY WALKS —
//     each at most 3 rows (utils/portfolio/attentionRows railSection), each
//     with its own 'See all N' to /attention?view=…, each hidden at 0 rows.
//     Their rows are the SAME builders and targets the Home cards use
//     (buildReadyToBill, buildDailyLogGaps, getUpcomingWarrantyWalks).
// One ScrollView holds the whole body so the sections scroll together.
// ============================================================================

import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { CloudOff, ChevronRight, CheckCircle2, MessageSquareWarning } from 'lucide-react-native';
import { useBrainWatch } from '@/hooks/useBrainWatch';
import { useCoreData, useDocsData, useProjects } from '@/contexts/ProjectContext';
import { rfiAttention, submittalAttention } from '@/utils/brainWatch';
import type { AttentionItem, AttnSeverity } from '@/utils/brainWatch';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { RowLink, routeHref } from '@/components/desktop/RowLink';
import { buildReadyToBill } from '@/utils/draftedRevenue';
import { formatMoney } from '@/utils/formatters';
import { getUpcomingWarrantyWalks, warrantyWalkTitle } from '@/utils/warrantyWalks';
import { resolveWarrantyMonths } from '@/utils/paymentTerms';
import {
  buildDailyLogGaps, railSection, dailyLogGapLine, dailyLogGapTarget,
} from '@/utils/portfolio/attentionRows';

/** Severity → theme ink (wave 6c: the hex literals were not theme-aware). */
function severityColor(severity: AttnSeverity, t: ThemeColors): string {
  if (severity === 'critical') return t.danger;
  if (severity === 'high') return t.warningLabel;
  return t.textSecondary;
}

/** Web-only print contract (wave 6b): the rail is chrome, not the page. */
const PRINT_HIDE: object = Platform.OS === 'web' ? { dataSet: { print: 'hide' } } : {};

export const RAIL_WIDTH = 300;

/** RT-R1: shown instead of "All caught up" when the probe could not reach
 *  MAGE — identical wording to components/home/BrainWatchCard. */
const UNREACHABLE_LINE =
  `Couldn't reach MAGE — showing what's on this ${Platform.OS === 'web' ? 'device' : 'phone'}`;

interface Props {
  width?: number;
}

const DesktopActionRail = React.memo(function DesktopActionRail({ width = RAIL_WIDTH }: Props) {
  const { items, sourceFailed } = useBrainWatch();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Gates the "all caught up" sentence only — never the pill, never the rows.
  // Same contexts and the same pure builders the canonical hook uses, so the two
  // cannot come to different conclusions about what an overdue RFI is.
  const { projects } = useCoreData();
  const { rfis, submittals } = useDocsData();
  const outsideTheScan = useMemo(() => {
    const nowMs = Date.now();
    let n = 0;
    for (const project of projects) {
      if (project.status === 'closed' || project.status === 'completed') continue;
      n += rfiAttention(project, rfis, nowMs).length;
      n += submittalAttention(project, submittals, nowMs).length;
    }
    return n;
  }, [projects, rfis, submittals]);

  const top = useMemo(() => items.slice(0, 8), [items]);

  // The three sections — the same builders the Home cards use, so the rail
  // and the cards it stands in for can never list different rows.
  const { changeOrders, dailyReports, settings } = useProjects();
  const ready = useMemo(
    () => buildReadyToBill({ changeOrders, projects, nowMs: Date.now() }),
    [changeOrders, projects],
  );
  const logGaps = useMemo(
    () => buildDailyLogGaps(projects, dailyReports, new Date().toISOString()),
    [projects, dailyReports],
  );
  const warrantyMonths = resolveWarrantyMonths(settings);
  const walks = useMemo(
    () => getUpcomingWarrantyWalks(projects, warrantyMonths),
    [projects, warrantyMonths],
  );
  const billSection = railSection(ready.rows);
  const logSection = railSection(logGaps);
  const walkSection = railSection(walks);

  const onRowPress = useCallback((item: AttentionItem) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    if (!item.route?.pathname) return; // never push a dead-end route
    if (item.route.params) router.push({ pathname: item.route.pathname, params: item.route.params } as any);
    else router.push(item.route.pathname as any);
  }, [router]);

  return (
    <View style={[styles.rail, { width }]} testID="desktop-action-rail" {...PRINT_HIDE}>
      <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Action Required</Text>
          {items.length > 0 ? (
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{items.length}</Text>
            </View>
          ) : null}
        </View>

        {items.length === 0 ? (
          sourceFailed ? (
            // RT-R1: an empty set from a failed read (dead session, no network)
            // is this device's last cache, not "all caught up" — same copy as
            // BrainWatchCard.
            <View style={styles.emptyState} testID="rail-unreachable">
              <View style={styles.emptyIconWrap}>
                <CloudOff size={22} color={colors.warningLabel} strokeWidth={1.8} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.warningLabel }]}>{UNREACHABLE_LINE}</Text>
              <Text style={styles.emptySubtitle}>Nothing cached needs attention; the live read failed.</Text>
            </View>
          ) : outsideTheScan > 0 ? (
            // Open work this column does not count. Named rather than swallowed,
            // and routed, because at this width there is no Inbox card below to
            // fall back on.
            <TouchableOpacity
              style={styles.emptyState}
              onPress={() => router.push('/waiting-on' as any)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Open Waiting On"
              testID="rail-partial-clear"
            >
              <View style={styles.emptyIconWrap}>
                <MessageSquareWarning size={22} color={colors.warningLabel} strokeWidth={1.8} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.warningLabel }]}>
                {outsideTheScan === 1 ? '1 reply is overdue' : `${outsideTheScan} replies are overdue`}
              </Text>
              <Text style={styles.emptySubtitle}>
                Schedules, invoices, permits and certs are clear. RFIs and submittals are not — open Waiting On.
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <CheckCircle2 size={22} color={colors.success} strokeWidth={1.8} />
              </View>
              <Text style={styles.emptyTitle}>All caught up</Text>
              <Text style={styles.emptySubtitle}>Nothing overdue on schedules, invoices, permits or certs.</Text>
            </View>
          )
        ) : (
          <View style={styles.listWrap}>
            {top.map(item => (
              <TouchableOpacity
                key={item.id}
                style={styles.row}
                onPress={() => onRowPress(item)}
                activeOpacity={0.7}
                accessibilityRole="button"
                testID={`rail-row-${item.id}`}
              >
                <View style={[styles.severityDot, { backgroundColor: severityColor(item.severity, colors) }]} />
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{item.message}</Text>
                </View>
                <ChevronRight size={14} color={colors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            ))}
            {items.length > top.length && (
              <RowLink
                href={routeHref('/attention')}
                accessibilityLabel={`See all ${items.length} items that need attention`}
                testID="rail-see-all"
              >
                <Text style={styles.moreText}>See all {items.length}</Text>
              </RowLink>
            )}
          </View>
        )}

        {billSection.shown.length > 0 ? (
          <RailSection
            title={`READY TO BILL · ${formatMoney(ready.total)}`}
            total={ready.rows.length}
            view="bill"
            testID="rail-section-bill"
            styles={styles}
          >
            {billSection.shown.map(row => (
              <TouchableOpacity
                key={row.id}
                style={styles.row}
                onPress={() => router.push({ pathname: '/change-order', params: { projectId: row.projectId, coId: row.id } })}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Review change order ${row.coNumber} for ${row.projectName}, ${formatMoney(row.amount)}`}
                testID={`rail-bill-${row.id}`}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {row.projectName} · CO #{row.coNumber} · {formatMoney(row.amount)}
                  </Text>
                </View>
                <ChevronRight size={14} color={colors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            ))}
          </RailSection>
        ) : null}

        {logSection.shown.length > 0 ? (
          <RailSection title="DAILY-LOG GAPS" total={logGaps.length} view="logs" testID="rail-section-logs" styles={styles}>
            {logSection.shown.map(row => (
              <TouchableOpacity
                key={row.projectId}
                style={styles.row}
                // A today row opens a NEW report (new: '1'): on desktop web a
                // bare projectId now opens the log (lane H).
                onPress={() => router.push({ pathname: '/daily-report', params: dailyLogGapTarget(row) })}
                activeOpacity={0.7}
                accessibilityRole="button"
                testID={`rail-log-${row.projectId}`}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{dailyLogGapLine(row)}</Text>
                </View>
                <ChevronRight size={14} color={colors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            ))}
          </RailSection>
        ) : null}

        {walkSection.shown.length > 0 ? (
          <RailSection title="WARRANTY WALKS" total={walks.length} view="warranty" testID="rail-section-warranty" styles={styles}>
            {walkSection.shown.map(a => (
              <TouchableOpacity
                key={a.project.id}
                style={styles.row}
                onPress={() => router.push({ pathname: '/warranty-walk', params: { projectId: a.project.id } })}
                activeOpacity={0.7}
                accessibilityRole="button"
                testID={`rail-walk-${a.project.id}`}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {a.project.name} · {a.warrantyMonthsAssumed ? 'Warranty walk' : warrantyWalkTitle(a.warrantyMonths)}
                  </Text>
                </View>
                <ChevronRight size={14} color={colors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            ))}
          </RailSection>
        ) : null}
      </ScrollView>
    </View>
  );
});

export default DesktopActionRail;

type Styles = ReturnType<typeof makeStyles>;

/** One rail section: a 13 px caption header, its rows, and 'See all N' to its
 *  /attention view when it holds more than it shows. */
function RailSection({ title, total, view, testID, styles, children }: {
  title: string;
  total: number;
  view: 'bill' | 'logs' | 'warranty';
  testID: string;
  styles: Styles;
  children: React.ReactNode;
}) {
  const shown = React.Children.count(children);
  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.sectionCaption} numberOfLines={1}>{title}</Text>
      <View style={styles.listWrap}>
        {children}
        {total > shown ? (
          <RowLink
            href={routeHref('/attention', { view })}
            accessibilityLabel={`See all ${total}`}
            testID={`${testID}-see-all`}
          >
            <Text style={styles.moreText}>See all {total}</Text>
          </RowLink>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  rail: {
    backgroundColor: t.bg,
    borderLeftWidth: 1,
    borderLeftColor: t.line,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 16,
  },
  section: {
    marginTop: 20,
  },
  sectionCaption: {
    ...Type.footnoteEmphasized,
    color: t.textSecondary,
    letterSpacing: 0.4,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 4,
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    letterSpacing: -0.1,
    flex: 1,
  },
  countPill: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.danger,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  countPillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.1,
  },
  emptyState: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: t.line,
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: 'center' as const,
    gap: 8,
  },
  emptyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.successSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  emptySubtitle: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    textAlign: 'center' as const,
  },
  listWrap: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: t.line,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.text,
    letterSpacing: -0.1,
  },
  moreText: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    fontWeight: '500' as const,
    paddingVertical: 10,
    paddingHorizontal: 14,
    textAlign: 'center' as const,
  },
});
