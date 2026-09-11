// cost-database.tsx — your personal price book, learned from closed jobs.
//
// Generic cost data is stale and locally wrong; your own history is the most
// accurate price book that exists for your work. This screen surfaces it: per
// trade + unit, what scope actually costs at your hands, how much it varies job
// to job, whether you systematically bid it high or low, and a blended rate to
// carry into the next bid. Built live from every closed job's bid-vs-actual
// ledger — pure aggregation over utils/costDatabase, no network.

import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, ChevronDown, ChevronRight, TrendingUp, TrendingDown, Globe } from 'lucide-react-native';
import { MageCostDb, MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborCostSamples } from '@/hooks/useLaborRates';
import { useCostSeeds } from '@/hooks/useCostSeeds';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { buildCostDatabase, type CostBookEntry, type CostSample } from '@/utils/costDatabase';
import { useCostBenchmark } from '@/hooks/useCostBenchmark';
import CostTruthChip from '@/components/CostTruthChip';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useBrainGrading } from '@/hooks/useBrainGrading';

function formatRate(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

/** "Mar 2024" for a measured-sample stamp; '' when there is nothing to date. */
function measuredMonth(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** What a sample rests on, in the contractor's words. 'actual' means a payment
 *  that SETTLED the commitment — a deposit falls back to "signed". */
function sampleBasisLabel(basis: CostSample['basis']): string {
  switch (basis) {
    case 'actual': return 'paid';
    case 'seeded': return 'you set this';
    case 'self_perform': return 'your crew + materials';
    default: return 'signed';
  }
}

/** Why a sample is shown but not averaged. Two very different reasons. */
function excludedSampleLabel(reason: CostSample['excludedReason']): string {
  switch (reason) {
    case 'change_order': return 'change order · not a unit price';
    case 'package_allocation': return 'package price · not a unit price';
    case 'material_component': return 'material price · not the installed rate';
    default: return 'one-off · not in rate';
  }
}

function notRateEvidenceNote(samples: CostSample[]): string {
  const co = samples.some(s => s.excludedReason === 'change_order');
  const pkg = samples.some(s => s.excludedReason === 'package_allocation');
  const parts: string[] = [];
  if (co) {
    parts.push('A change order added scope after the bid, so the extra dollars sit over the original quantity — that number is not what a unit costs, so it is shown but never averaged.');
  }
  if (pkg) {
    parts.push('This sub was bought out as one package across several estimate lines. Splitting that price back across the lines just reproduces your own estimate, so it teaches no unit rate.');
  }
  return parts.join(' ');
}

/** The material-price exclusion gets its OWN sentence for the same reason the
 *  two above do: these samples are neither weird jobs nor non-prices. They are
 *  correct material prices — they just are not what this row measures, and the
 *  row's own number is partly made of them. */
const MATERIAL_COMPONENT_NOTE =
  'This rate is what the scope costs INSTALLED — your crew\u2019s hours plus the materials. '
  + 'The material prices are kept here for the record but never averaged into it: a board '
  + 'price and an installed price are different numbers, and mixing them would drag your '
  + 'rate below what the work actually costs you.';

export default function CostDatabaseScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return (
      <Paywall
        visible={true}
        feature="Cost Database"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <CostDatabaseInner />;
}

function CostDatabaseInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projects, commitments } = useProjects();
  const { receipts } = useMaterialReceipts();
  // Self-perform labor (D6): the book's own screen must show every source
  // that feeds it — crew hours appear as "Labor — <trade>" $/hour entries.
  const laborSamples = useLaborCostSamples();
  // Cold-start seeds — rates the GC stated on /cost-seed. They show here from
  // day one, tagged so they can never be mistaken for measured history.
  const { seeds } = useCostSeeds();
  const { canAccess } = useTierAccess();
  const { accuracyReport } = useBrainGrading();

  const db = useMemo(
    () => buildCostDatabase(projects, commitments, receipts, laborSamples, seeds),
    [projects, commitments, receipts, laborSamples, seeds],
  );

  // Cost Truth: contribute my learned rates + read the cross-contractor
  // regional benchmark (aggregate-only, k-anonymized).
  //
  // ONLY MEASURED RATES ARE PUBLISHED. This used to map db.entries with no
  // provenance filter, and useCostBenchmark upserts every row it is handed
  // into cost_benchmark_samples — which public.public_cost_index reads. So a
  // contractor who turned the Public Price Index on published the rates he
  // TYPED as if they were paid rates, into an index utils/costTruth describes
  // to every other contractor as "real paid rates, not catalog averages" and
  // this screen sells as "the data RSMeans charges thousands for". The seed
  // firewall is enforced everywhere a rate is DISPLAYED; this was the one path
  // where a breach is irreversible, because it leaves the tenant. The hook
  // re-checks the same rule (defence in depth), so a new screen cannot leak by
  // forgetting this filter.
  const benchInputs = useMemo(
    () => db.entries
      .filter((e) => e.provenance === 'earned' && (e.jobCount ?? 0) >= 1)
      .map((e) => ({ trade: e.trade, unit: e.unit, personalRate: e.personalRate, provenance: e.provenance, jobCount: e.jobCount })),
    [db.entries],
  );
  const { statsFor, publicOptIn, setPublicOptIn } = useCostBenchmark(benchInputs);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback((key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const confColor = (c: CostBookEntry['confidence']) =>
    c === 'high' ? t.success : c === 'medium' ? t.accent : t.textMuted;

  // Trades we READ off a closed job and deliberately refused to price (every
  // sample behind them was a change-order-bearing commitment or a package
  // price). They are not in `entries` so nothing can quote a $0.00 rate, but
  // they must still be visible — a job that silently vanished from the book
  // would be exactly the invisible degradation this screen exists to prevent.
  const awaiting = db.entriesAwaitingEvidence ?? [];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Cost Database · MAGE ID</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>Your prices</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      {db.entries.length === 0 && awaiting.length === 0 ? (
        <EmptyState
          icon={<MageCostDb size={36} color={t.accent} />}
          title="No price history yet"
          message="Your cost database learns what work actually costs from every job you close — which means it has nothing on day one. Don't wait six months for it:"
          steps={[
            'Seed the rates you already know — paste a trade/unit/price list in a minute.',
            'Close projects that had a cost estimate; commitments linked to estimate lines (buyout does this) become samples.',
            'Every closed job corrects what you seeded — measurement always beats a stated rate.',
          ]}
          actionLabel="Seed your rates"
          onAction={() => router.push('/cost-seed' as any)}
          secondaryLabel="Open Projects"
          onSecondaryAction={() => router.push('/(tabs)/(home)' as any)}
        />
      ) : (
        <ScrollView {...fabScroll} contentContainerStyle={[{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }, isDesktop && styles.contentDesktop]} showsVerticalScrollIndicator={false}>
          {/* Public Price Index opt-in. OFF by default and stated plainly —
              your rates stay private unless you choose to publish, and even
              then only an anonymous median across 5+ contractors is shown. */}
          <View style={styles.publicIndexCard}>
            <View style={styles.publicIndexTop}>
              <Globe size={15} color={t.accent} strokeWidth={2} />
              <Text style={styles.publicIndexTitle}>Public Price Index</Text>
              <Switch
                value={publicOptIn === true}
                onValueChange={(v) => { void setPublicOptIn(v); }}
                disabled={publicOptIn === null}
                trackColor={{ false: t.line, true: t.accent }}
                testID="cost-public-index-toggle"
              />
            </View>
            <Text style={styles.publicIndexBody}>
              {publicOptIn
                ? 'Your rates help build the only public index of what construction actually costs. Only an anonymous median across 5+ contractors is ever published — never your numbers, never your name.'
                : 'Off. Your rates stay private. Turn this on to contribute an anonymous median (5+ contractors minimum) to the free public price index — the data RSMeans charges thousands for.'}
            </Text>
          </View>

          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Trades</Text>
              <Text style={styles.kpiValue}>{db.tradesTracked}</Text>
              {/* "closed jobs" was a lie on this line: jobsAnalyzed counts any
                  project with a snapped receipt or a clocked shift too, so a
                  GC with six live jobs and no closeouts read "6 closed jobs".
                  Say what is actually counted. */}
              <Text style={styles.kpiSub}>
                {db.jobsAnalyzed} job{db.jobsAnalyzed === 1 ? '' : 's'} with cost data
                {(db.tradesSeededOnly ?? 0) > 0 ? ` · ${db.tradesSeededOnly} you set` : ''}
              </Text>
            </View>
            {/* Tappable: the KPI states the problem, /estimate-scorecard says
                which trades cause it and what it costs in dollars. */}
            <TouchableOpacity
              style={styles.kpiCard}
              onPress={() => router.push('/estimate-scorecard')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Open estimate scorecard"
              testID="cost-db-accuracy-kpi"
            >
              <Text style={styles.kpiLabel}>Bid accuracy</Text>
              <Text style={[styles.kpiValue, { color: db.overallBidAccuracy !== null && db.overallBidAccuracy < 0.85 ? t.accentHot : t.text }]}>
                {db.overallBidAccuracy !== null ? `${Math.round(db.overallBidAccuracy * 100)}%` : '—'}
              </Text>
              <Text style={[styles.kpiSub, { color: t.accent }]}>see what it costs you</Text>
            </TouchableOpacity>
          </View>

          {/* Brain accuracy section — Business+ gated */}
          {canAccess('brain_accuracy') && (
            <View style={styles.accuracySection}>
              <View style={styles.accuracySectionHeader}>
                <MageAIMark size={14} color={t.accent} />
                <Text style={styles.accuracySectionTitle}>Brain accuracy</Text>
              </View>
              {accuracyReport.hasEnoughData ? (
                accuracyReport.rows.map(row => (
                  <View key={row.kind} style={styles.accuracyCard}>
                    <Text style={styles.accuracyLabel}>{row.label}</Text>
                    <Text style={styles.accuracyHeadline}>{row.headline}</Text>
                    <Text style={styles.accuracyDetail}>{row.detail}</Text>
                    {row.rate != null && (
                      <View style={styles.accuracyBarTrack}>
                        <View style={[styles.accuracyBarFill, { width: `${Math.round(row.rate * 100)}%` as any }]} />
                      </View>
                    )}
                  </View>
                ))
              ) : (
                <View style={styles.accuracyEmpty}>
                  <Text style={styles.accuracyEmptyText}>
                    The brain is grading itself — first results after your predictions resolve.
                  </Text>
                </View>
              )}
            </View>
          )}

          <Text style={styles.sectionTitle}>By trade · unit</Text>
          {db.entries.map(e => {
            const isOpen = expanded.has(e.key);
            const cc = confColor(e.confidence);
            const bench = statsFor(e.trade, e.unit);
            const bidsLow = e.bidBias > 0.02;
            const bidsHigh = e.bidBias < -0.02;
            return (
              <View key={e.key} style={styles.card}>
                <TouchableOpacity
                  style={styles.cardHead}
                  onPress={() => toggle(e.key)}
                  activeOpacity={0.7}
                  testID={`cost-entry-${e.key}`}
                >
                  <View style={styles.cardHeadBody}>
                    <Text style={styles.cardTrade} numberOfLines={1}>{e.trade}</Text>
                    {/* A rate the GC stated must never read as measured
                        history. 'seeded' says so; 'mixed' admits the seed is
                        still in there while real jobs correct it. */}
                    <Text style={styles.cardMeta}>
                      {e.provenance === 'seeded'
                        ? `per ${e.unit} · you set this`
                        : `per ${e.unit} · ${e.jobCount} job${e.jobCount === 1 ? '' : 's'}`}
                      {e.provenance === 'seeded'
                        ? null
                        : <Text style={{ color: cc }}> · {e.confidence}</Text>}
                      {e.provenance === 'mixed' ? ' · started from your set rate' : ''}
                      {/* Signed subs with nothing paid out yet. Real evidence,
                          but not a measured cost — the header used to be the
                          one place that did not say so, while every sample row
                          below already read "signed". */}
                      {e.provenance !== 'seeded' && e.earnedBasis === 'contracted'
                        ? ' · signed, not yet paid'
                        : ''}
                      {e.excludedSampleCount && e.excludedSampleCount > 0
                        ? ` · ${e.excludedSampleCount} one-off set aside`
                        : ''}
                      {e.notRateEvidenceCount && e.notRateEvidenceCount > 0
                        ? ` · ${e.notRateEvidenceCount} not a unit price`
                        : ''}
                      {e.materialComponentCount && e.materialComponentCount > 0
                        ? ` · ${e.materialComponentCount} material price${e.materialComponentCount === 1 ? '' : 's'} set aside`
                        : ''}
                    </Text>
                    {e.provenance === 'seeded' ? (
                      <View style={styles.seedBadge}>
                        <Text style={styles.seedBadgeText}>YOU SET THIS · NOT YET MEASURED</Text>
                      </View>
                    ) : null}
                    {bench ? (
                      <View style={{ marginTop: 5 }}>
                        <CostTruthChip stats={bench} rate={e.personalRate} />
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.rateBox}>
                    <Text style={styles.rateVal}>{formatRate(e.suggestedRate)}</Text>
                    {/* The ± band is a claim about repeatability. From one
                        sample it is undefined, not zero — this printed
                        "$2.00 ±0%" after a single job — and from six clocked
                        shifts at one typed rate it is arithmetic, not
                        observation. utils/takeoffPricing already suppressed
                        it; this card did not. spreadMeaningful decides. */}
                    {e.spreadMeaningful && e.variability > 0 ? (
                      <Text style={styles.rateSub}>±{Math.round(e.variability * 100)}%</Text>
                    ) : (
                      // jobCount is JOBS. Printing it as "N samples" on the one
                      // screen whose whole subject is that the counts are
                      // honest was the mirror image of the bug below: an entry
                      // with one job and five receipt lines read "1 sample".
                      <Text style={styles.rateSub}>
                        {e.jobCount > 0 ? `${e.jobCount} job${e.jobCount === 1 ? '' : 's'}` : 'no spread yet'}
                      </Text>
                    )}
                  </View>
                  {isOpen ? <ChevronDown size={18} color={t.textMuted} strokeWidth={1.75} /> : <ChevronRight size={18} color={t.textMuted} strokeWidth={1.75} />}
                </TouchableOpacity>

                {(bidsLow || bidsHigh) && (
                  <View style={styles.biasRow}>
                    {bidsLow ? <TrendingUp size={12} color={t.danger} strokeWidth={1.75} /> : <TrendingDown size={12} color={t.success} strokeWidth={1.75} />}
                    <Text style={[styles.biasText, { color: bidsLow ? t.danger : t.success }]}>
                      You bid this ~{Math.abs(Math.round(e.bidBias * 100))}% {bidsLow ? 'under' : 'over'} actual cost
                    </Text>
                  </View>
                )}

                {isOpen && (
                  <View style={styles.detail}>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Your actual rate</Text>
                      <Text style={styles.detailVal}>{formatRate(e.personalRate)}/{e.unit}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Last bid assumption</Text>
                      <Text style={styles.detailVal}>{formatRate(e.baseline)}/{e.unit}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Suggested next bid</Text>
                      <Text style={[styles.detailVal, { color: t.accent }]}>{formatRate(e.suggestedRate)}/{e.unit}</Text>
                    </View>
                    {/* WHEN. lastSeen was computed and read by nothing, so a
                        returning contractor could not tell that the rate
                        pricing his next bid was measured four years ago.
                        Seeds are excluded from it — a date you typed on a rate
                        sheet is not a date we measured anything. */}
                    {measuredMonth(e.lastSeen) ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Last measured</Text>
                        <Text style={styles.detailVal}>{measuredMonth(e.lastSeen)}</Text>
                      </View>
                    ) : null}
                    <Text style={styles.samplesTitle}>Samples</Text>
                    {e.samples.map((s, i) => (
                      <View key={`${s.projectId}-${i}`} style={styles.sampleRow}>
                        <Text style={styles.sampleName} numberOfLines={1}>{s.projectName}</Text>
                        <Text style={[styles.sampleRate, s.excludedFromRate ? styles.sampleRateExcluded : null]}>
                          {formatRate(s.actualUnit)}
                          <Text style={styles.sampleBasis}>
                            {s.excludedFromRate
                              ? ` ${excludedSampleLabel(s.excludedReason)}`
                              : ` ${sampleBasisLabel(s.basis)}`}
                          </Text>
                        </Text>
                      </View>
                    ))}
                    {e.excludedSampleCount && e.excludedSampleCount > 0 ? (
                      <Text style={styles.excludedNote}>
                        A job that came in far off your usual is kept here for the record but left
                        out of the learned rate, so one bad week (weather, a typo) can&rsquo;t skew
                        your next bid.
                      </Text>
                    ) : null}
                    {/* A DIFFERENT sentence for a different exclusion. These
                        samples are not weird jobs — they are numbers that
                        cannot be a unit price at all, and explaining them with
                        the one-off-blowout line would be a lie about the
                        contractor's work. */}
                    {e.notRateEvidenceCount && e.notRateEvidenceCount > 0 ? (
                      <Text style={styles.excludedNote}>
                        {notRateEvidenceNote(e.samples)}
                      </Text>
                    ) : null}
                    {e.materialComponentCount && e.materialComponentCount > 0 ? (
                      <Text style={styles.excludedNote}>{MATERIAL_COMPONENT_NOTE}</Text>
                    ) : null}
                  </View>
                )}
              </View>
            );
          })}

          {awaiting.length > 0 ? (
            <View style={styles.awaitingSection}>
              <Text style={styles.sectionTitle}>Read, but not priced</Text>
              {awaiting.map(e => {
                // SAMPLES ARE NOT JOBS. A package buyout split across two
                // estimate lines of ONE closed job produces two samples, and
                // this card printed "2 jobs seen" for them — on the screen
                // whose entire subject is that the counts here are honest.
                const jobsSeen = new Set(e.samples.map(s => s.projectId).filter(Boolean)).size;
                return (
                <View key={e.key} style={styles.awaitingCard}>
                  <Text style={styles.cardTrade} numberOfLines={1}>{e.trade}</Text>
                  <Text style={styles.cardMeta}>
                    per {e.unit} · {jobsSeen} job{jobsSeen === 1 ? '' : 's'} seen · no unit rate yet
                  </Text>
                  <Text style={styles.excludedNote}>{notRateEvidenceNote(e.samples)}</Text>
                </View>
                );
              })}
            </View>
          ) : null}

          <Text style={styles.note}>
            Suggested rate blends your most recent bid assumption toward your measured actuals
            as you close more jobs (more samples = more weight on reality). &ldquo;Paid&rdquo; samples are
            payments that settled the sub contract; &ldquo;signed&rdquo; samples are the committed sub/PO
            amount on a closed job, which is what that scope cost you even before the cheque clears.
            A part-paid contract is never read as a finished cost.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  // Cost tables: data-dense, so desktop gets the viewport rather than a
  // 760px column. 1400 matches contentMaxWidth in useResponsiveLayout.
  contentDesktop: { width: '100%', maxWidth: 1400, alignSelf: 'center' as const },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerBtn: { width: 38, height: 38, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerText: { flex: 1 },
  headerEyebrow: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, letterSpacing: 0.4 },
  headerTitle: { ...Type.serifHeadline, color: t.text },

  publicIndexCard: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.panel,
    padding: 14,
    marginBottom: 14,
  },
  publicIndexTop: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  publicIndexTitle: { ...Type.subheadEmphasized, color: t.text, flex: 1 },
  publicIndexBody: { ...Type.caption1, color: t.textSecondary, lineHeight: 17, marginTop: 8 },
  kpiRow: { flexDirection: 'row' as const, gap: 12, marginBottom: 14 },
  kpiCard: {
    flex: 1, backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 16, gap: 3,
  },
  kpiLabel: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  kpiValue: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text },
  kpiSub: { fontSize: Type.caption1.fontSize, color: t.textMuted },

  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10 },

  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, marginBottom: 8, overflow: 'hidden' as const,
  },
  cardHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, padding: 12 },
  cardHeadBody: { flex: 1, gap: 2 },
  cardTrade: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  cardMeta: { fontSize: Type.caption1.fontSize, color: t.textSecondary },
  // A stated rate has to LOOK different from a measured one, not just read
  // differently — the whole moat is "these are real numbers".
  seedBadge: {
    alignSelf: 'flex-start' as const, marginTop: 5,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: Tokens.radius.full, backgroundColor: t.accentSoft,
  },
  seedBadgeText: {
    fontSize: Type.caption2.fontSize, fontWeight: '800' as const,
    color: t.accentLabel, letterSpacing: 0.4,
  },
  rateBox: { alignItems: 'flex-end' as const },
  rateVal: { fontSize: Type.headline.fontSize, fontWeight: '800' as const, color: t.text },
  rateSub: { fontSize: Type.caption2.fontSize, color: t.textMuted },

  biasRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    paddingHorizontal: 12, paddingBottom: 12, marginTop: -2,
  },
  biasText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const },

  detail: {
    borderTopWidth: 1, borderTopColor: t.line,
    padding: 12, gap: 6, backgroundColor: t.surfaceAlt,
  },
  detailRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  detailLabel: { fontSize: Type.caption1.fontSize, color: t.textSecondary },
  detailVal: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  samplesTitle: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '700' as const, letterSpacing: 0.3, marginTop: 6 },
  sampleRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, gap: 8 },
  sampleName: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary },
  sampleRate: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.text },
  sampleRateExcluded: { color: t.textMuted, textDecorationLine: 'line-through' as const },
  sampleBasis: { fontSize: Type.caption2.fontSize, fontWeight: '400' as const, color: t.textMuted },
  excludedNote: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 15, marginTop: 6, fontStyle: 'italic' as const },

  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 8 },

  awaitingSection: { marginTop: 18 },
  awaitingCard: {
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, marginBottom: 8, padding: 12, gap: 2,
  },

  accuracySection: {
    marginBottom: 20,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.panel,
    overflow: 'hidden' as const,
  },
  accuracySectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xs,
    backgroundColor: t.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  accuracySectionTitle: {
    ...Type.subheadEmphasized,
    color: t.text,
  },
  accuracyCard: {
    backgroundColor: t.bg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  accuracyLabel: {
    ...Type.caption1,
    color: t.textMuted,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  accuracyHeadline: {
    ...Type.subhead,
    color: t.text,
    fontWeight: '700' as const,
  },
  accuracyDetail: {
    ...Type.footnote,
    color: t.textSecondary,
    lineHeight: 18,
  },
  accuracyBarTrack: {
    height: 4,
    backgroundColor: t.line,
    borderRadius: Tokens.radius.full,
    marginTop: 6,
    overflow: 'hidden' as const,
  },
  accuracyBarFill: {
    height: 4,
    backgroundColor: t.accent,
    borderRadius: Tokens.radius.full,
  },
  accuracyEmpty: {
    backgroundColor: t.bg,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  accuracyEmptyText: {
    ...Type.footnote,
    color: t.textSecondary,
    fontStyle: 'italic' as const,
  },
});
