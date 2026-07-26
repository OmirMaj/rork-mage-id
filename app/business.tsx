// app/business.tsx — Your Business: CEO-view portfolio intelligence
//
// Business+ gated (useTierAccess 'brain_accuracy' proxy, consistent with
// the broader intelligence gate already in use). Four sections:
//   1. Margin by job type  — links to /portfolio-margin for per-project view
//   2. Pipeline vs Capacity — two win rates, 4/8/12-week load, backlog
//   3. Client Book — top clients by revenue with payment + CO friction
//   4. Seasonality — weather-lost days/month
//
// Desktop-first: maxWidth 780 centered. Mobile-safe.
// Anti-slop tokens throughout: Type.*, Tokens.*, t.*  — no raw hex/fontSize.
// Cold-start states per metric: "N more jobs until this is trustworthy."

import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft, ChevronRight, TrendingUp, Users, BarChart3,
  CloudRain,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import {
  useCoreData, useFinancialsData, useFieldData, usePreconData,
} from '@/contexts/ProjectContext';
import { useBidResponsesPortfolio } from '@/hooks/useBidResponsesPortfolio';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { buildTypeProfitability } from '@/utils/portfolio/typeProfitability';
import { buildPipelineHorizon } from '@/utils/portfolio/pipelineHorizon';
import { buildClientBook } from '@/utils/portfolio/clientBook';
import { buildWeatherSeasonality } from '@/utils/portfolio/seasonality';

// ── Business gate ──────────────────────────────────────────────────────────

export default function BusinessScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('brain_accuracy')) {
    return (
      <Paywall
        visible={true}
        feature="Your Business"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <BusinessInner />;
}

// ── Money formatter ───────────────────────────────────────────────────────

function fmtMoney(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function fmtLoadPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

// ── Section header component ──────────────────────────────────────────────

function SectionHeader({
  icon: Icon, label, onPress, styles, t,
}: {
  icon: React.ComponentType<{ size: number; color: string }>;
  label: string;
  onPress?: () => void;
  styles: ReturnType<typeof makeStyles>;
  t: ThemeColors;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Icon size={16} color={t.accent} />
      <Text style={styles.sectionLabel}>{label}</Text>
      {onPress && (
        <TouchableOpacity onPress={onPress} hitSlop={8} style={styles.sectionDrillIn}>
          <Text style={styles.sectionDrillInText}>See all</Text>
          <ChevronRight size={12} color={t.accent} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Cold-start note ───────────────────────────────────────────────────────

function ColdStartNote({ text, styles }: { text: string; styles: ReturnType<typeof makeStyles> }) {
  return <Text style={styles.coldStart}>{text}</Text>;
}

// ── Inner screen ──────────────────────────────────────────────────────────

function BusinessInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDesktop } = useResponsiveLayout();

  const { projects } = useCoreData();
  const { invoices, changeOrders, commitments } = useFinancialsData();
  const { dailyReports } = useFieldData();
  const { leads } = usePreconData();
  const { bidResponses } = useBidResponsesPortfolio();

  const now = useMemo(() => new Date(), []);

  // ── Engine outputs ────────────────────────────────────────────────────

  const typeProfit = useMemo(
    () => buildTypeProfitability(projects, commitments),
    [projects, commitments],
  );

  const pipeline = useMemo(
    () => buildPipelineHorizon({ leads, projects, invoices, changeOrders, commitments, bidResponses, now }),
    [leads, projects, invoices, changeOrders, commitments, bidResponses, now],
  );

  const clientBook = useMemo(
    () => buildClientBook({ projects, invoices, changeOrders }),
    [projects, invoices, changeOrders],
  );

  const seasonality = useMemo(
    () => buildWeatherSeasonality(dailyReports),
    [dailyReports],
  );

  // ── Type profitability section ────────────────────────────────────────

  const visibleTypeRows = useMemo(
    () =>
      typeProfit.rows
        .filter(r => !r.gated && r.avgMarginPct !== null)
        .sort((a, b) => (b.revenueWeightedMarginPct ?? 0) - (a.revenueWeightedMarginPct ?? 0))
        .slice(0, 6),
    [typeProfit],
  );

  const gatedTypeCount = typeProfit.rows.filter(r => r.gated && r.jobCount > 0).length;

  // ── Render ─────────────────────────────────────────────────────────────

  const contentStyle = isDesktop ? styles.contentDesktop : styles.contentMobile;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Your Business',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
              <ChevronLeft size={22} color={t.text} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={contentStyle}>

          {/* ── Section 1: Margin by Job Type ───────────────────────── */}
          <View style={styles.section}>
            <SectionHeader
              icon={TrendingUp}
              label="Margin by Job Type"
              onPress={() => router.push('/portfolio-margin')}
              styles={styles}
              t={t}
            />
            {visibleTypeRows.length === 0 ? (
              <ColdStartNote
                text={`Closes feed this — ${typeProfit.coverage.closedWithBasis} of 2 jobs needed for your first type comparison.`}
                styles={styles}
              />
            ) : (
              <>
                {visibleTypeRows.map(row => (
                  <View key={row.type} style={styles.metricRow}>
                    <Text style={styles.metricLabel}>{row.label}</Text>
                    <View style={styles.metricRight}>
                      <Text style={[
                        styles.metricValue,
                        { color: (row.revenueWeightedMarginPct ?? row.avgMarginPct ?? 0) >= 0 ? t.success : t.danger },
                      ]}>
                        {fmtPct(row.revenueWeightedMarginPct ?? row.avgMarginPct ?? 0)}
                      </Text>
                      <Text style={styles.metricSub}>{row.jobCount} job{row.jobCount === 1 ? '' : 's'}</Text>
                    </View>
                  </View>
                ))}
                {gatedTypeCount > 0 && (
                  <ColdStartNote
                    text={`${gatedTypeCount} other type${gatedTypeCount === 1 ? '' : 's'} need 1 more closed job to report margin.`}
                    styles={styles}
                  />
                )}
              </>
            )}
            <Text style={styles.definitionNote}>{typeProfit.definitionNote}</Text>
            <TouchableOpacity style={styles.seeAllRow} onPress={() => router.push('/portfolio-margin')}>
              <Text style={styles.seeAllText}>Per-project view</Text>
              <ChevronRight size={14} color={t.accent} />
            </TouchableOpacity>
          </View>

          {/* ── Section 2: Pipeline vs Capacity ─────────────────────── */}
          <View style={styles.section}>
            <SectionHeader
              icon={BarChart3}
              label="Pipeline vs Capacity"
              styles={styles}
              t={t}
            />

            {/* Win rates */}
            <View style={styles.twoColumn}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>CRM Win Rate</Text>
                {pipeline.winRates.crm !== null ? (
                  <Text style={styles.kpiValue}>{fmtPct(pipeline.winRates.crm)}</Text>
                ) : (
                  <Text style={styles.kpiValueMuted}>—</Text>
                )}
                {pipeline.winRates.crm === null && (
                  <ColdStartNote
                    text={`${Math.max(0, 3 - pipeline.leadCount)} more decided leads needed`}
                    styles={styles}
                  />
                )}
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Bid Win Rate</Text>
                {pipeline.winRates.outbound !== null ? (
                  <Text style={styles.kpiValue}>{fmtPct(pipeline.winRates.outbound)}</Text>
                ) : (
                  <Text style={styles.kpiValueMuted}>—</Text>
                )}
                {pipeline.winRates.outbound === null && (
                  <ColdStartNote text="3 decided bids needed" styles={styles} />
                )}
              </View>
            </View>

            {/* Pipeline numbers */}
            {pipeline.leadCount > 0 && (
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Active pipeline</Text>
                <View style={styles.metricRight}>
                  <Text style={styles.metricValue}>{fmtMoney(pipeline.leadPipeline$)}</Text>
                  <Text style={styles.metricSub}>{pipeline.leadCount} lead{pipeline.leadCount === 1 ? '' : 's'}</Text>
                </View>
              </View>
            )}
            {pipeline.pendingBidsCount > 0 && (
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Pending bids</Text>
                <View style={styles.metricRight}>
                  <Text style={styles.metricValue}>{fmtMoney(pipeline.pendingBids$)}</Text>
                  <Text style={styles.metricSub}>{pipeline.pendingBidsCount} bid{pipeline.pendingBidsCount === 1 ? '' : 's'}</Text>
                </View>
              </View>
            )}
            {pipeline.expectedInflow$ > 0 && (
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Expected inflow</Text>
                <View style={styles.metricRight}>
                  <Text style={[styles.metricValue, { color: t.success }]}>{fmtMoney(pipeline.expectedInflow$)}</Text>
                  <Text style={styles.metricSub}>pipeline × win rate</Text>
                </View>
              </View>
            )}

            {/* Backlog */}
            {pipeline.backlog.remainingToBill$ > 0 && (
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Remaining to bill</Text>
                <View style={styles.metricRight}>
                  <Text style={styles.metricValue}>{fmtMoney(pipeline.backlog.remainingToBill$)}</Text>
                  {pipeline.backlog.horizonDate && (
                    <Text style={styles.metricSub}>through {pipeline.backlog.horizonDate}</Text>
                  )}
                </View>
              </View>
            )}

            {/* Load bars */}
            <Text style={styles.subSectionLabel}>Crew Load</Text>
            {pipeline.loadWindows.map(w => (
              <View key={w.label} style={styles.loadRow}>
                <Text style={styles.loadLabel}>{w.label}</Text>
                <View style={styles.loadBarTrack}>
                  <View style={[
                    styles.loadBarFill,
                    {
                      width: `${Math.round(w.loadPct * 100)}%` as unknown as number,
                      backgroundColor: w.bookedSolid ? t.danger : w.loadPct > 0.6 ? t.accentHot : t.accent,
                    },
                  ]} />
                </View>
                <Text style={[styles.loadPct, { color: w.bookedSolid ? t.danger : t.textSecondary }]}>
                  {fmtLoadPct(w.loadPct)}
                </Text>
              </View>
            ))}
            <Text style={styles.caveat}>{pipeline.loadCaveat}</Text>
          </View>

          {/* ── Section 3: Client Book ───────────────────────────────── */}
          <View style={styles.section}>
            <SectionHeader
              icon={Users}
              label="Client Book"
              styles={styles}
              t={t}
            />
            <Text style={styles.coverageNote}>{clientBook.coverageNote}</Text>

            {clientBook.clients.length === 0 ? (
              <ColdStartNote
                text="Client identity fills in from the contact info on your projects."
                styles={styles}
              />
            ) : (
              <>
                {clientBook.clients.slice(0, 5).map(client => (
                  <View key={client.key} style={styles.clientRow}>
                    <View style={styles.clientLeft}>
                      <Text style={styles.clientName} numberOfLines={1}>{client.displayName}</Text>
                      <Text style={styles.clientSub}>
                        {client.projectCount} project{client.projectCount === 1 ? '' : 's'}
                        {client.repeat ? ' · repeat' : ''}
                        {client.payment.medianDaysToPaid !== null
                          ? ` · pays in ${Math.round(client.payment.medianDaysToPaid)}d median`
                          : ''}
                      </Text>
                      {client.payment.overdue$ > 0 && (
                        <Text style={[styles.clientAlert, { color: t.danger }]}>
                          {fmtMoney(client.payment.overdue$)} overdue
                        </Text>
                      )}
                      {client.coFriction.count > 0 && (
                        <Text style={styles.clientSub}>
                          {client.coFriction.count} CO{client.coFriction.count === 1 ? '' : 's'}
                          {client.coFriction.rejectionRate > 0
                            ? ` · ${fmtPct(client.coFriction.rejectionRate)} rejected`
                            : ''}
                        </Text>
                      )}
                    </View>
                    <Text style={styles.clientRevenue}>{fmtMoney(client.lifetimeRevenue)}</Text>
                  </View>
                ))}
                {clientBook.clients.length > 5 && (
                  <Text style={styles.moreClients}>
                    +{clientBook.clients.length - 5} more client{clientBook.clients.length - 5 === 1 ? '' : 's'}
                  </Text>
                )}
              </>
            )}
          </View>

          {/* ── Section 4: Seasonality ───────────────────────────────── */}
          <View style={styles.section}>
            <SectionHeader
              icon={CloudRain}
              label="Weather Impact"
              styles={styles}
              t={t}
            />
            {seasonality.noData ? (
              <ColdStartNote
                text={`Weather patterns build from your daily reports — ${seasonality.reportCount} filed so far.`}
                styles={styles}
              />
            ) : (
              <>
                {seasonality.months.slice(0, 6).map(m => (
                  <View key={m.month} style={styles.metricRow}>
                    <Text style={styles.metricLabel}>{m.label}</Text>
                    <View style={styles.metricRight}>
                      <Text style={styles.metricValue}>{m.avgLostDays.toFixed(1)}d</Text>
                      <Text style={styles.metricSub}>avg weather-lost</Text>
                    </View>
                  </View>
                ))}
                <Text style={styles.caveat}>{seasonality.deferredNote}</Text>
              </>
            )}
          </View>

        </View>
      </ScrollView>
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

function makeStyles(t: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.bg,
    },
    scroll: {
      paddingTop: Tokens.spacing.md,
    },
    contentMobile: {
      paddingHorizontal: Tokens.spacing.md,
    },
    contentDesktop: {
      width: '100%',
      maxWidth: 780,
      alignSelf: 'center' as const,
      paddingHorizontal: Tokens.spacing.lg,
    },
    section: {
      backgroundColor: t.surface,
      borderRadius: Tokens.radius.panel,
      padding: Tokens.spacing.md,
      marginBottom: Tokens.spacing.md,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Tokens.spacing.xs,
      marginBottom: Tokens.spacing.sm,
    },
    sectionLabel: {
      ...Type.bodyCompactEmphasized,
      color: t.text,
      flex: 1,
    },
    sectionDrillIn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    sectionDrillInText: {
      ...Type.caption1,
      color: t.accent,
    },
    metricRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: Tokens.spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
    },
    metricLabel: {
      ...Type.body,
      color: t.text,
      flex: 1,
    },
    metricRight: {
      alignItems: 'flex-end',
    },
    metricValue: {
      ...Type.bodyCompactEmphasized,
      color: t.text,
    },
    metricSub: {
      ...Type.caption1,
      color: t.textSecondary,
    },
    definitionNote: {
      ...Type.caption1,
      color: t.textSecondary,
      marginTop: Tokens.spacing.sm,
    },
    seeAllRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      marginTop: Tokens.spacing.xs,
      gap: 2,
    },
    seeAllText: {
      ...Type.caption1,
      color: t.accent,
    },
    coldStart: {
      ...Type.caption1,
      color: t.textSecondary,
      fontStyle: 'italic',
      paddingVertical: Tokens.spacing.sm,
    },
    twoColumn: {
      flexDirection: 'row',
      gap: Tokens.spacing.sm,
      marginBottom: Tokens.spacing.sm,
    },
    kpiCard: {
      flex: 1,
      backgroundColor: t.surfaceAlt,
      borderRadius: Tokens.radius.card,
      padding: Tokens.spacing.sm,
    },
    kpiLabel: {
      ...Type.caption1,
      color: t.textSecondary,
      marginBottom: 2,
    },
    kpiValue: {
      ...Type.title3,
      color: t.text,
    },
    kpiValueMuted: {
      ...Type.title3,
      color: t.textSecondary,
    },
    subSectionLabel: {
      ...Type.caption1,
      color: t.textSecondary,
      marginTop: Tokens.spacing.sm,
      marginBottom: Tokens.spacing.xs,
      textTransform: 'uppercase' as const,
      letterSpacing: 0.5,
    },
    loadRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Tokens.spacing.sm,
      marginBottom: Tokens.spacing.xs,
    },
    loadLabel: {
      ...Type.caption1,
      color: t.text,
      width: 90,
    },
    loadBarTrack: {
      flex: 1,
      height: 6,
      backgroundColor: t.surfaceAlt,
      borderRadius: Tokens.radius.full,
      overflow: 'hidden',
    },
    loadBarFill: {
      height: '100%',
      borderRadius: Tokens.radius.full,
    },
    loadPct: {
      ...Type.caption1,
      width: 36,
      textAlign: 'right' as const,
    },
    caveat: {
      ...Type.caption1,
      color: t.textSecondary,
      fontStyle: 'italic',
      marginTop: Tokens.spacing.xs,
    },
    coverageNote: {
      ...Type.caption1,
      color: t.textSecondary,
      marginBottom: Tokens.spacing.sm,
    },
    clientRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingVertical: Tokens.spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
    },
    clientLeft: {
      flex: 1,
      marginRight: Tokens.spacing.sm,
    },
    clientName: {
      ...Type.bodyCompactEmphasized,
      color: t.text,
    },
    clientSub: {
      ...Type.caption1,
      color: t.textSecondary,
    },
    clientAlert: {
      ...Type.caption1,
    },
    clientRevenue: {
      ...Type.bodyCompactEmphasized,
      color: t.text,
    },
    moreClients: {
      ...Type.caption1,
      color: t.textSecondary,
      marginTop: Tokens.spacing.xs,
      textAlign: 'right' as const,
    },
  });
}
