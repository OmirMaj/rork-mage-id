// Buyout package detail — the bid leveling matrix.
//
// The hero feature: a side-by-side comparison of every bid received
// for a single scope package, with AI-suggested adjustments to make
// the bids apples-to-apples. The GC can:
//   - Add a bid by voice ("Joe's came in at 4800, excludes fixtures")
//   - Add a bid by hand
//   - Run AI leveling to compute fair adjustments per bid
//   - Mark a bid winner — one tap converts to a Commitment, marks the
//     package "Awarded," and stamps the buyout savings
//
// What separates this from legacy GC software: the leveling step.
// Most platforms show three bids in a list and let you pick. This
// screen reads the inclusions/exclusions, applies a dollar adjustment,
// and shows you the TRUE leveled total — so you don't award to a
// "low" bid that was actually the highest after the missing scope
// shows up as a change order in week 2.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, Modal, KeyboardAvoidingView, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, Mic, Sparkles, X, Save, Trophy, AlertTriangle, CheckCircle2,
  Trash2, ChevronDown, ChevronUp, Briefcase, ArrowRight, FileDown,
} from 'lucide-react-native';
import { generateA401PDF, type A401Data } from '@/utils/aiaForms';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import {
  BID_PACKAGE_STATUS_LABELS, type BidPackage, type BidPackageBid, type BidPackageStatus,
} from '@/types';
import { formatMoney } from '@/utils/formatters';
import VoiceCaptureModal from '@/components/VoiceCaptureModal';
import { parseBidFromTranscript } from '@/utils/voiceFormParsers';
import { levelBids, type LevelingResult } from '@/utils/bidLevelingEngine';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const STATUS_COLORS: Record<BidPackageStatus, string> = {
  open: '#FF6A1A',
  leveling: '#0D6CB1',
  awarded: '#16A34A',
  cancelled: '#9CA3AF',
};

export default function BuyoutPackageScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { packageId } = useLocalSearchParams<{ packageId: string }>();
  const {
    getBidPackage, updateBidPackage, deleteBidPackage,
    getBidsForPackage, addBidPackageBid, updateBidPackageBid, deleteBidPackageBid,
    awardBidPackage, getProject, prequalPackets, getSubcontractor,
    settings,
  } = useProjects();
  const { tier: subscriptionTier } = useSubscription();

  const pkg = useMemo(() => packageId ? getBidPackage(packageId) : null, [packageId, getBidPackage]);
  const bids = useMemo(() => packageId ? getBidsForPackage(packageId) : [], [packageId, getBidsForPackage]);
  const project = useMemo(() => pkg ? getProject(pkg.projectId) : null, [pkg, getProject]);

  // Identify allowance items that the package will lock to firm price
  // when awarded. This drives the "contains allowances" banner so the
  // GC understands the buyout's downstream effect on the estimate.
  const allowanceItems = useMemo(() => {
    if (!pkg || !project?.linkedEstimate) return [];
    return project.linkedEstimate.items.filter(
      i => pkg.linkedEstimateItemIds.includes(i.materialId) && i.isAllowance,
    );
  }, [pkg, project]);

  const [voiceOpen, setVoiceOpen] = useState(false);
  const [showAddBid, setShowAddBid] = useState(false);
  const [newVendor, setNewVendor] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newIncludes, setNewIncludes] = useState('');
  const [newExcludes, setNewExcludes] = useState('');
  const [newTerms, setNewTerms] = useState('');

  const [leveling, setLeveling] = useState(false);
  const [levelingResult, setLevelingResult] = useState<LevelingResult | null>(null);

  // ── Add bid by voice ─────────────────────────────────────────
  const handleVoiceBid = useCallback(async (transcript: string) => {
    if (!pkg) return;
    const partial = await parseBidFromTranscript(transcript);
    addBidPackageBid({
      packageId: pkg.id,
      vendorName: partial.vendorName || 'Voice-captured bid',
      amount: partial.amount || 0,
      includes: partial.includes || undefined,
      excludes: partial.excludes || undefined,
      terms: partial.terms || undefined,
      source: 'voice',
      status: 'received',
    });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [pkg, addBidPackageBid]);

  // ── Add bid manually ────────────────────────────────────────
  const handleAddBid = useCallback(() => {
    if (!pkg) return;
    if (!newVendor.trim() || !newAmount) {
      Alert.alert('Missing info', 'Vendor name and amount are both required.');
      return;
    }
    addBidPackageBid({
      packageId: pkg.id,
      vendorName: newVendor.trim(),
      amount: Number(newAmount),
      includes: newIncludes.trim() || undefined,
      excludes: newExcludes.trim() || undefined,
      terms: newTerms.trim() || undefined,
      source: 'manual',
      status: 'received',
    });
    setShowAddBid(false);
    setNewVendor(''); setNewAmount(''); setNewIncludes(''); setNewExcludes(''); setNewTerms('');
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [pkg, newVendor, newAmount, newIncludes, newExcludes, newTerms, addBidPackageBid]);

  // ── AI leveling ─────────────────────────────────────────────
  const handleLevel = useCallback(async () => {
    if (!pkg || bids.length < 2) {
      Alert.alert('Need 2+ bids', 'Add at least two bids before running AI leveling.');
      return;
    }
    // Bid Leveling is a Pro+ feature — too compute-expensive to give away
    // free, and it's the most "wow" feature for converting prospects.
    const limit = await checkAILimit(subscriptionTier, 'smart', 'bidLeveling');
    if (!limit.allowed) {
      showAILimitAlert({ limit, router });
      return;
    }
    setLeveling(true);
    try {
      const result = await levelBids({ pkg, bids });
      await recordAIUsage('smart', 'bidLeveling');
      setLevelingResult(result);
      // Persist each adjustment back to the bid records — but only when
      // the AI actually succeeded. confidence === 0 is the failure
      // sentinel from the engine; persisting "AI unavailable — review
      // manually" onto bids leaves stale reasons that confuse users on
      // a successful re-run (code-review #8).
      for (const adj of result.adjustments) {
        if (adj.confidence === 0) continue;
        updateBidPackageBid(adj.bidId, {
          normalizedAdjustment: adj.adjustment,
          normalizedAdjustmentReason: adj.reason,
        });
      }
      // Surface AI-down state to the GC so they don't think leveling
      // silently worked. Empty summary + every adjustment at confidence 0
      // is the failure signature.
      if (result.summary === '' && result.adjustments.every(a => a.confidence === 0)) {
        Alert.alert('AI leveling unavailable', 'The AI is offline right now. Try again in a minute, or compare bids manually.');
      } else {
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      Alert.alert('Leveling failed', String((err as Error)?.message || err));
    } finally {
      setLeveling(false);
    }
  }, [pkg, bids, updateBidPackageBid, subscriptionTier]);

  // ── Award a bid ─────────────────────────────────────────────
  // Prequal gate (industry must-have): when the bidder is a tracked
  // Subcontractor with a PrequalPacket, check that the packet is
  // 'approved' and not 'expired' before awarding. If missing or stale,
  // we WARN but don't block — the GC can still award after seeing the
  // gap, because residential <$5M typically simplifies docs.
  const handleAward = useCallback((bid: BidPackageBid) => {
    if (!pkg) return;
    const total = bid.amount + (bid.normalizedAdjustment ?? 0);
    const savings = pkg.estimateBudget - total;

    // Prequal lookup. We match by subcontractorId first; if the bid
    // came in by voice with just a vendorName, there's no link yet
    // and we surface that as a softer "no prequal on file" warning.
    const sub = bid.subcontractorId ? getSubcontractor(bid.subcontractorId) : null;
    const packet = sub
      ? prequalPackets.find(p => p.subcontractorId === sub.id)
      : null;
    const prequalGap = !packet
      ? (sub ? 'No prequal packet on file for this sub.' : 'Bid is not linked to a tracked subcontractor — no prequal docs verified.')
      : (packet.status === 'approved' ? null
        : packet.status === 'expired' ? 'Prequal packet has EXPIRED — renewal required.'
        : `Prequal packet status: ${packet.status} (not yet approved).`);

    const lines: string[] = [];
    lines.push(`Vendor: ${bid.vendorName ?? sub?.companyName ?? 'Subcontractor'}`);
    lines.push(`Leveled total: ${formatMoney(total)}`);
    lines.push(`Buyout ${savings >= 0 ? 'savings' : 'overrun'}: ${formatMoney(Math.abs(savings))}`);
    if (allowanceItems.length > 0) {
      lines.push('');
      lines.push(`✓ ${allowanceItems.length} allowance item${allowanceItems.length === 1 ? '' : 's'} will lock to firm price.`);
    }
    if (prequalGap) {
      lines.push('');
      lines.push(`⚠️ Prequal: ${prequalGap}`);
    }
    lines.push('');
    lines.push('Awarding will create a Commitment and mark this package complete.');

    Alert.alert(
      prequalGap ? 'Award without prequal docs?' : 'Award this bid?',
      lines.join('\n'),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: prequalGap ? 'Award anyway' : 'Award',
          style: prequalGap ? 'destructive' : 'default',
          onPress: () => {
            const commitmentId = awardBidPackage(pkg.id, bid.id);
            if (commitmentId) {
              if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
          },
        },
      ],
    );
  }, [pkg, awardBidPackage, getSubcontractor, prequalPackets, allowanceItems]);

  // Generate A401-styled subcontract PDF for the awarded sub. Pulls
  // scope, contract sum, and CSI division from the bid package; pulls
  // sub info from the awarded bid; pulls GC info from settings.branding.
  // The GC fills in any missing pieces (start date, retainage % override,
  // insurance reqs) by editing the form on the GC's letterhead.
  const handleGenerateSubcontract = useCallback(async () => {
    if (!pkg || !pkg.awardedBidId || !project) return;
    const winningBid = bids.find(b => b.id === pkg.awardedBidId);
    if (!winningBid) {
      Alert.alert('No awarded bid', 'Award a bid before generating the subcontract.');
      return;
    }
    const branding = settings?.branding ?? { companyName: 'MAGE ID', address: '', phone: '', email: '', licenseNumber: '', tagline: '', contactName: '' };
    const ownerName = (project.clientPortal?.invites?.[0]?.name) ?? (project as { owner?: string }).owner ?? 'Owner';
    try {
      const data: A401Data = {
        subcontractNumber: 1, // future: track subcontracts per package; sequential per project
        agreementDate: new Date().toISOString(),
        contractorName: branding.companyName,
        contractorAddress: branding.address,
        subcontractorName: winningBid.vendorName ?? 'Subcontractor',
        subcontractorAddress: undefined,
        subcontractorLicense: undefined,
        ownerName,
        architectName: undefined,
        projectName: project.name,
        projectAddress: (project as { location?: string }).location ?? '',
        primeContractDate: undefined,
        scopeDescription: pkg.scopeDescription || pkg.name || 'Per attached scope',
        csiDivision: pkg.csiDivision,
        contractSum: winningBid.amount ?? 0,
        retainagePercent: 10,
        paymentTerms: 'Net 30 from approved monthly pay application',
        startDate: undefined,
        substantialCompletionDate: undefined,
        liquidatedDamagesPerDay: undefined,
        insuranceRequirements: 'GL $1M / $2M agg, Auto $1M, WC statutory, Umbrella $2M; Owner + Contractor named additional insured w/ waiver of subrogation',
        bondsRequired: 'none',
        lienWaiverRequired: true,
        exhibits: [
          'Exhibit A — Scope of work + drawings list',
          'Exhibit B — Schedule of values',
          'Exhibit C — Project schedule (current baseline)',
          'Exhibit D — Insurance requirements (signed COI)',
          'Exhibit E — Lien waiver templates (conditional/unconditional)',
          'Exhibit F — Safety plan acknowledgment',
        ],
        specialConditions: undefined,
      };
      await generateA401PDF(data, branding);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('[Buyout] A401 generate failed:', err);
      Alert.alert('Could not generate subcontract', err instanceof Error ? err.message : 'Try again.');
    }
  }, [pkg, bids, project, settings]);

  const handleDeletePackage = useCallback(() => {
    if (!pkg) return;
    Alert.alert(
      'Delete package?',
      'This deletes the package and all its bids. Cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => { deleteBidPackage(pkg.id); router.back(); },
        },
      ],
    );
  }, [pkg, deleteBidPackage, router]);

  if (!pkg) {
    return (
      <>
        <Stack.Screen options={{ title: 'Package' }} />
        <View style={styles.notFound}>
          <Text style={styles.notFoundText}>Package not found</Text>
        </View>
      </>
    );
  }

  // Sort bids by leveled total ascending — winning bid floats up.
  const sortedBids = [...bids].sort((a, b) =>
    (a.amount + (a.normalizedAdjustment ?? 0)) - (b.amount + (b.normalizedAdjustment ?? 0))
  );
  const winningBidId = levelingResult?.recommendedWinnerBidId;

  // ── Outlier detection (industry standard: >15% from median = review).
  // Per Buildr / Archdesk research: a bid significantly below the median
  // is almost always missing scope; significantly above usually means the
  // sub priced in protection / unfamiliarity. Either way, the GC needs to
  // pause before awarding. We compute against the leveled total so the
  // AI's adjustments are already factored in.
  const leveledTotals = sortedBids.map(b => b.amount + (b.normalizedAdjustment ?? 0));
  const median = leveledTotals.length === 0 ? 0
    : leveledTotals.length % 2 === 1
      ? leveledTotals[Math.floor(leveledTotals.length / 2)]
      : (leveledTotals[leveledTotals.length / 2 - 1] + leveledTotals[leveledTotals.length / 2]) / 2;
  const isOutlier = (bid: BidPackageBid): { kind: 'low' | 'high'; pct: number } | null => {
    if (median === 0 || sortedBids.length < 2) return null;
    const total = bid.amount + (bid.normalizedAdjustment ?? 0);
    const deltaPct = ((total - median) / median) * 100;
    if (deltaPct < -15) return { kind: 'low', pct: Math.abs(deltaPct) };
    if (deltaPct > 15) return { kind: 'high', pct: deltaPct };
    return null;
  };

  // ── Coverage warning: <3 bids is industry "review" threshold.
  const lowCoverage = pkg.status !== 'awarded' && pkg.status !== 'cancelled' && bids.length > 0 && bids.length < 3;

  // ── Days-since-opened (the stale-RFQ signal).
  const daysSinceOpened = (() => {
    if (pkg.status === 'awarded' || pkg.status === 'cancelled') return null;
    const ms = Date.now() - new Date(pkg.createdAt).getTime();
    return Math.max(0, Math.floor(ms / 86400000));
  })();
  const stale = daysSinceOpened != null && daysSinceOpened >= 14 && pkg.status !== 'awarded';

  return (
    <>
      <Stack.Screen options={{ title: pkg.name, headerLargeTitle: false }} />
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 130 }}>
          {/* Hero card with status + budget */}
          <View style={styles.hero}>
            <View style={styles.heroTopRow}>
              <View style={[styles.statusPill, { backgroundColor: STATUS_COLORS[pkg.status] + '22', borderColor: STATUS_COLORS[pkg.status] + '60' }]}>
                <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[pkg.status] }]} />
                <Text style={[styles.statusPillText, { color: STATUS_COLORS[pkg.status] }]}>{BID_PACKAGE_STATUS_LABELS[pkg.status]}</Text>
              </View>
              {!!pkg.phase && <Text style={styles.heroPhase}>{pkg.phase}</Text>}
            </View>
            <Text style={styles.heroName}>{pkg.name}</Text>
            <View style={styles.heroBudgetRow}>
              <View style={styles.heroBudgetCell}>
                <Text style={styles.heroBudgetLabel}>Estimate budget</Text>
                <Text style={styles.heroBudgetValue}>{formatMoney(pkg.estimateBudget)}</Text>
              </View>
              {pkg.status === 'awarded' && pkg.buyoutSavings != null ? (
                <View style={styles.heroBudgetCell}>
                  <Text style={styles.heroBudgetLabel}>Buyout {pkg.buyoutSavings >= 0 ? 'savings' : 'overrun'}</Text>
                  <Text style={[styles.heroBudgetValue, { color: pkg.buyoutSavings >= 0 ? Colors.success : Colors.error }]}>
                    {pkg.buyoutSavings >= 0 ? '+' : ''}{formatMoney(pkg.buyoutSavings)}
                  </Text>
                </View>
              ) : (
                <View style={styles.heroBudgetCell}>
                  <Text style={styles.heroBudgetLabel}>Bids received</Text>
                  <Text style={styles.heroBudgetValue}>{bids.length}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Industry-standard warning band (allowance + coverage + stale) */}
          {(allowanceItems.length > 0 || lowCoverage || stale) && (
            <View style={styles.section}>
              {allowanceItems.length > 0 && pkg.status !== 'awarded' && (
                <View style={[styles.warningCard, { backgroundColor: '#0D6CB112', borderLeftColor: '#0D6CB1' }]}>
                  <AlertTriangle size={14} color="#0D6CB1" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.warningTitle}>Contains {allowanceItems.length} allowance item{allowanceItems.length === 1 ? '' : 's'}</Text>
                    <Text style={styles.warningBody}>
                      {allowanceItems.slice(0, 3).map(i => i.name).join(', ')}
                      {allowanceItems.length > 3 ? ` +${allowanceItems.length - 3} more` : ''}.
                      Awarding this package locks them to firm price in the estimate and homeowner portal.
                    </Text>
                  </View>
                </View>
              )}
              {lowCoverage && (
                <View style={styles.warningCard}>
                  <AlertTriangle size={14} color={Colors.warning} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.warningTitle}>Coverage risk · {bids.length} bid{bids.length === 1 ? '' : 's'} in</Text>
                    <Text style={styles.warningBody}>Industry best practice is 3+ qualified bids per package. Send the RFQ to more subs before awarding.</Text>
                  </View>
                </View>
              )}
              {stale && (
                <View style={styles.warningCard}>
                  <AlertTriangle size={14} color={Colors.warning} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.warningTitle}>Stale package · {daysSinceOpened} days open</Text>
                    <Text style={styles.warningBody}>Material pricing windows are typically 30 days. Award soon or re-bid to avoid expired numbers.</Text>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Run-leveling CTA when 2+ bids and not awarded */}
          {pkg.status !== 'awarded' && bids.length >= 2 && (
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.levelBtn}
                onPress={handleLevel}
                disabled={leveling}
                activeOpacity={0.85}
              >
                {leveling ? (
                  <>
                    <ActivityIndicator size="small" color="#FFF" />
                    <Text style={styles.levelBtnText}>AI is leveling these bids…</Text>
                  </>
                ) : (
                  <>
                    <Sparkles size={16} color="#FFF" />
                    <Text style={styles.levelBtnText}>{levelingResult ? 'Re-run AI leveling' : 'Run AI leveling'}</Text>
                  </>
                )}
              </TouchableOpacity>
              {!!levelingResult?.summary && (
                <View style={styles.levelingSummary}>
                  <View style={styles.levelingSummaryHead}>
                    <Sparkles size={14} color={Colors.primary} />
                    <Text style={styles.levelingSummaryHeadText}>AI leveling summary</Text>
                  </View>
                  <Text style={styles.levelingSummaryBody}>{levelingResult.summary}</Text>
                  {!!levelingResult.recommendedWinnerReason && (
                    <View style={styles.recommendation}>
                      <Trophy size={14} color={Colors.success} />
                      <Text style={styles.recommendationText}>{levelingResult.recommendedWinnerReason}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Bid leveling matrix */}
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Bids</Text>
              <Text style={styles.sectionSub}>{bids.length === 0 ? 'Add the first bid' : `${bids.length} received`}</Text>
            </View>

            {sortedBids.length === 0 ? (
              <View style={styles.emptyBids}>
                <Text style={styles.emptyBidsText}>
                  Tap "Add by voice" or "Add by hand" to log incoming sub bids. MAGE ID will compare them apples-to-apples and recommend a winner.
                </Text>
              </View>
            ) : (
              sortedBids.map((bid, i) => {
                const total = bid.amount + (bid.normalizedAdjustment ?? 0);
                const vsBudget = pkg.estimateBudget - total;
                const isWinner = winningBidId === bid.id;
                const isLowest = i === 0 && sortedBids.length > 1;
                const outlier = isOutlier(bid);
                return (
                  <View key={bid.id} style={[styles.bidCard, isWinner && styles.bidCardWinner, bid.status === 'awarded' && styles.bidCardAwarded, outlier && styles.bidCardOutlier]}>
                    <View style={styles.bidHead}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.bidNameRow}>
                          <Text style={styles.bidVendor} numberOfLines={1}>{bid.vendorName ?? 'Subcontractor'}</Text>
                          {isWinner && (
                            <View style={styles.winnerBadge}>
                              <Trophy size={10} color="#FFF" />
                              <Text style={styles.winnerBadgeText}>AI PICK</Text>
                            </View>
                          )}
                          {isLowest && !isWinner && (
                            <View style={styles.lowestBadge}>
                              <Text style={styles.lowestBadgeText}>LOWEST</Text>
                            </View>
                          )}
                          {bid.status === 'awarded' && (
                            <View style={styles.awardedBadge}>
                              <CheckCircle2 size={10} color="#FFF" />
                              <Text style={styles.awardedBadgeText}>AWARDED</Text>
                            </View>
                          )}
                          {outlier && (
                            <View style={styles.outlierBadge}>
                              <AlertTriangle size={10} color="#FFF" />
                              <Text style={styles.outlierBadgeText}>
                                {outlier.kind === 'low' ? `${outlier.pct.toFixed(0)}% LOW` : `${outlier.pct.toFixed(0)}% HIGH`}
                              </Text>
                            </View>
                          )}
                        </View>
                        {outlier && (
                          <Text style={styles.outlierHint}>
                            {outlier.kind === 'low'
                              ? '⚠️ Significantly below the median — review for missing scope before awarding.'
                              : '⚠️ Significantly above the median — sub may have priced in protection or unfamiliarity.'}
                          </Text>
                        )}
                        {!!bid.terms && <Text style={styles.bidTerms} numberOfLines={1}>{bid.terms}</Text>}
                      </View>
                      <TouchableOpacity onPress={() => deleteBidPackageBid(bid.id)} hitSlop={10} style={styles.bidDelete} accessibilityRole="button" accessibilityLabel="Delete">
                        <Trash2 size={14} color={Colors.textMuted} />
                      </TouchableOpacity>
                    </View>

                    <View style={styles.bidAmountsRow}>
                      <View style={styles.bidAmountCell}>
                        <Text style={styles.bidAmountLabel}>Bid</Text>
                        <Text style={styles.bidAmountValue}>{formatMoney(bid.amount)}</Text>
                      </View>
                      {bid.normalizedAdjustment != null && bid.normalizedAdjustment !== 0 && (
                        <View style={styles.bidAmountCell}>
                          <Text style={styles.bidAmountLabel}>Adj.</Text>
                          <Text style={[styles.bidAmountValue, { color: bid.normalizedAdjustment > 0 ? Colors.warning : Colors.success }]}>
                            {bid.normalizedAdjustment > 0 ? '+' : ''}{formatMoney(bid.normalizedAdjustment)}
                          </Text>
                        </View>
                      )}
                      <View style={styles.bidAmountCell}>
                        <Text style={[styles.bidAmountLabel, { color: Colors.text, fontWeight: '700' }]}>Leveled total</Text>
                        <Text style={[styles.bidAmountValueTotal, { color: vsBudget >= 0 ? Colors.success : Colors.error }]}>
                          {formatMoney(total)}
                        </Text>
                      </View>
                    </View>

                    {!!bid.includes && (
                      <View style={styles.bidScopeBlock}>
                        <Text style={styles.bidScopeLabel}>Includes</Text>
                        <Text style={styles.bidScopeText}>{bid.includes}</Text>
                      </View>
                    )}
                    {!!bid.excludes && (
                      <View style={[styles.bidScopeBlock, { backgroundColor: Colors.error + '0F', borderLeftColor: Colors.error }]}>
                        <Text style={[styles.bidScopeLabel, { color: Colors.error }]}>Excludes</Text>
                        <Text style={styles.bidScopeText}>{bid.excludes}</Text>
                      </View>
                    )}
                    {!!bid.normalizedAdjustmentReason && (
                      <View style={styles.adjReason}>
                        <Sparkles size={11} color={Colors.primary} />
                        <Text style={styles.adjReasonText}>{bid.normalizedAdjustmentReason}</Text>
                      </View>
                    )}

                    {pkg.status !== 'awarded' && (
                      <TouchableOpacity style={styles.awardBtn} onPress={() => handleAward(bid)} activeOpacity={0.85}>
                        <Trophy size={14} color="#FFF" />
                        <Text style={styles.awardBtnText}>Award · {formatMoney(total)}</Text>
                        <ArrowRight size={14} color="#FFF" />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )}
          </View>

          {/* Quick action: open the awarded commitment */}
          {pkg.status === 'awarded' && pkg.awardedCommitmentId && (
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.openCommitmentBtn}
                onPress={() => router.push({ pathname: '/project-detail' as never, params: { id: pkg.projectId } as never })}
                activeOpacity={0.85}
              >
                <Briefcase size={16} color={Colors.primary} />
                <Text style={styles.openCommitmentText}>Open project · view this commitment</Text>
                <ChevronUp size={16} color={Colors.primary} style={{ transform: [{ rotate: '90deg' }] }} />
              </TouchableOpacity>
            </View>
          )}

          {/* Generate A401 subcontract — available once the package is
              awarded. Pre-fills from the awarded bid + project + GC
              branding. The PDF is the GC's deliverable to the sub for
              countersignature before NTP. */}
          {pkg.status === 'awarded' && pkg.awardedBidId && (
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.openCommitmentBtn}
                onPress={handleGenerateSubcontract}
                activeOpacity={0.85}
                testID="generate-a401"
              >
                <FileDown size={16} color={Colors.primary} />
                <Text style={styles.openCommitmentText}>Generate A401-style subcontract PDF</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Delete package */}
          <View style={styles.section}>
            <TouchableOpacity onPress={handleDeletePackage} style={styles.deletePkgBtn} activeOpacity={0.7}>
              <Trash2 size={14} color={Colors.error} />
              <Text style={styles.deletePkgText}>Delete this package</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Add-bid FAB row */}
        {pkg.status !== 'awarded' && (
          <View style={[styles.fabRow, { bottom: insets.bottom + 18 }]}>
            <TouchableOpacity style={styles.fabSecondary} onPress={() => setShowAddBid(true)} activeOpacity={0.85}>
              <Plus size={16} color={Colors.text} />
              <Text style={styles.fabSecondaryText}>Add by hand</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.fabPrimary} onPress={() => setVoiceOpen(true)} activeOpacity={0.85}>
              <Mic size={16} color="#FFF" />
              <Text style={styles.fabPrimaryText}>Add bid by voice</Text>
              <Sparkles size={12} color="#FFF" />
            </TouchableOpacity>
          </View>
        )}

        {/* Voice modal */}
        <VoiceCaptureModal
          visible={voiceOpen}
          onClose={() => setVoiceOpen(false)}
          onTranscriptReady={handleVoiceBid}
          title={`Log a bid for ${pkg.name}`}
          contextLine="Speak the sub's name, amount, and what's included or excluded"
          suggestions={[
            "Joe's Plumbing came in at forty-eight hundred, includes everything except fixtures",
            "ABC Mechanical at twelve thousand five hundred, all-in, ten percent deposit",
            "Westside Electric, six thousand two hundred, excludes permits and trim work",
            "Mike's Drywall at thirty-two hundred, hang and finish only, no paint",
          ]}
        />

        {/* Add-bid modal */}
        <Modal visible={showAddBid} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAddBid(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: Colors.background }}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Log a bid</Text>
              <TouchableOpacity onPress={() => setShowAddBid(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <X size={22} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: Tokens.spacing.lg }}>
              <Text style={styles.fieldLabel}>Vendor *</Text>
              <TextInput style={styles.input} value={newVendor} onChangeText={setNewVendor} placeholder="e.g. Joe's Plumbing" placeholderTextColor={Colors.textMuted} autoFocus />
              <Text style={styles.fieldLabel}>Amount *</Text>
              <TextInput style={styles.input} value={newAmount} onChangeText={setNewAmount} placeholder="Total dollar bid" placeholderTextColor={Colors.textMuted} keyboardType="numeric" />
              <Text style={styles.fieldLabel}>Includes</Text>
              <TextInput style={[styles.input, styles.multilineInput]} value={newIncludes} onChangeText={setNewIncludes} placeholder="What's covered (drives leveling)" placeholderTextColor={Colors.textMuted} multiline />
              <Text style={styles.fieldLabel}>Excludes</Text>
              <TextInput style={[styles.input, styles.multilineInput]} value={newExcludes} onChangeText={setNewExcludes} placeholder="What's NOT covered (the gotcha)" placeholderTextColor={Colors.textMuted} multiline />
              <Text style={styles.fieldLabel}>Terms</Text>
              <TextInput style={styles.input} value={newTerms} onChangeText={setNewTerms} placeholder="Net 30, 10% deposit, etc." placeholderTextColor={Colors.textMuted} />
            </ScrollView>
            <View style={[styles.modalFoot, { paddingBottom: insets.bottom + 12 }]}>
              <TouchableOpacity style={styles.saveBtn} onPress={handleAddBid} activeOpacity={0.85}>
                <Save size={16} color="#FFF" />
                <Text style={styles.saveBtnText}>Save bid</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: Type.subhead.fontSize, color: Colors.textMuted },

  hero: {
    margin: Tokens.spacing.md,
    padding: 18,
    borderRadius: Tokens.radius.xl,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs, marginBottom: Tokens.spacing.sm },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusPillText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, letterSpacing: 0.3, textTransform: 'uppercase' },
  heroPhase: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, fontWeight: '600' as const },
  heroName: { fontSize: 24, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.5, marginBottom: 14 },
  heroBudgetRow: { flexDirection: 'row', gap: Tokens.spacing.md },
  heroBudgetCell: { flex: 1 },
  heroBudgetLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: Tokens.spacing.xxs },
  heroBudgetValue: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: Colors.text },

  section: { paddingHorizontal: Tokens.spacing.md, paddingBottom: Tokens.spacing.xs },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: Tokens.spacing.sm, marginTop: Tokens.spacing.xxs },
  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.3 },
  sectionSub: { fontSize: Type.caption1.fontSize, color: Colors.textMuted },

  levelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Tokens.spacing.xs,
    backgroundColor: Colors.text,
    paddingVertical: 14,
    borderRadius: Tokens.radius.lg,
  },
  levelBtnText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const },
  levelingSummary: {
    marginTop: Tokens.spacing.sm,
    backgroundColor: Colors.primary + '0F',
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
    borderRadius: Tokens.radius.card,
    padding: 14,
    gap: 6,
  },
  levelingSummaryHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  levelingSummaryHeadText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  levelingSummaryBody: { fontSize: Type.footnote.fontSize, color: Colors.text, lineHeight: 19 },
  recommendation: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Tokens.spacing.xxs, padding: Tokens.spacing.xs, backgroundColor: Colors.success + '15', borderRadius: Tokens.radius.sm },
  recommendationText: { flex: 1, fontSize: Type.caption1.fontSize, color: Colors.text, lineHeight: 17, fontWeight: '600' as const },

  emptyBids: { backgroundColor: Colors.surface, borderRadius: Tokens.radius.lg, padding: 22, borderWidth: 1, borderColor: Colors.cardBorder },
  emptyBidsText: { fontSize: Type.footnote.fontSize, color: Colors.textMuted, textAlign: 'center', lineHeight: 19 },

  bidCard: { backgroundColor: Colors.surface, borderRadius: Tokens.radius.lg, padding: 14, borderWidth: 1, borderColor: Colors.cardBorder, marginBottom: 10, gap: 10 },
  bidCardWinner: { borderColor: Colors.success, borderWidth: 2, backgroundColor: Colors.success + '08' },
  bidCardAwarded: { borderColor: Colors.success, borderWidth: 2 },
  bidCardOutlier: { borderColor: Colors.warning + '80', borderWidth: 1.5 },
  outlierBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.warning, paddingHorizontal: 6, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  outlierBadgeText: { fontSize: 9, fontWeight: '800' as const, color: '#FFF', letterSpacing: 0.5 },
  outlierHint: { fontSize: Type.caption2.fontSize, color: Colors.warning, marginTop: Tokens.spacing.xxs, lineHeight: 15, fontWeight: '600' as const },
  warningCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: Colors.warning + '12', borderLeftWidth: 4, borderLeftColor: Colors.warning, padding: Tokens.spacing.sm, borderRadius: Tokens.radius.md, marginBottom: Tokens.spacing.xs },
  warningTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: Colors.text },
  warningBody: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline, lineHeight: 17 },
  bidHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Tokens.spacing.xs },
  bidNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  bidVendor: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: Colors.text },
  bidTerms: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline },
  bidDelete: { padding: Tokens.spacing.xxs },
  winnerBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.success, paddingHorizontal: 6, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  winnerBadgeText: { fontSize: 9, fontWeight: '800' as const, color: '#FFF', letterSpacing: 0.5 },
  lowestBadge: { backgroundColor: Colors.primary + '22', paddingHorizontal: 6, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  lowestBadgeText: { fontSize: 9, fontWeight: '800' as const, color: Colors.primary, letterSpacing: 0.5 },
  awardedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.success, paddingHorizontal: 6, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  awardedBadgeText: { fontSize: 9, fontWeight: '800' as const, color: '#FFF', letterSpacing: 0.5 },

  bidAmountsRow: { flexDirection: 'row', gap: 14, paddingVertical: Tokens.spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Colors.cardBorder },
  bidAmountCell: { flex: 1 },
  bidAmountLabel: { fontSize: 10, fontWeight: '700' as const, color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: Tokens.spacing.xxs },
  bidAmountValue: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: Colors.text },
  bidAmountValueTotal: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const },

  bidScopeBlock: { backgroundColor: Colors.fillTertiary, borderLeftWidth: 4, borderLeftColor: Colors.success, borderRadius: Tokens.radius.sm, padding: 10, gap: Tokens.spacing.xxs },
  bidScopeLabel: { fontSize: 10, fontWeight: '700' as const, color: Colors.success, letterSpacing: 0.5, textTransform: 'uppercase' },
  bidScopeText: { fontSize: Type.footnote.fontSize, color: Colors.text, lineHeight: 18 },

  adjReason: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: 10, backgroundColor: Colors.primary + '08', borderRadius: Tokens.radius.sm },
  adjReasonText: { flex: 1, fontSize: Type.caption1.fontSize, color: Colors.text, lineHeight: 17, fontStyle: 'italic' },

  awardBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Tokens.spacing.xs, backgroundColor: Colors.success, paddingVertical: Tokens.spacing.sm, borderRadius: Tokens.radius.card },
  awardBtnText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const },

  openCommitmentBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Tokens.spacing.xs, backgroundColor: Colors.primary + '15', paddingVertical: 14, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: Colors.primary + '40' },
  openCommitmentText: { color: Colors.primary, fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const },

  deletePkgBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Tokens.spacing.sm },
  deletePkgText: { fontSize: Type.footnote.fontSize, color: Colors.error, fontWeight: '600' as const },

  fabRow: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', gap: Tokens.spacing.xs },
  fabSecondary: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surface, paddingHorizontal: 14, paddingVertical: 14, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: Colors.cardBorder },
  fabSecondaryText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: Colors.text },
  fabPrimary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Tokens.spacing.xs, backgroundColor: Colors.primary, paddingVertical: 14, borderRadius: Tokens.radius.lg, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  fabPrimaryText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const },

  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.cardBorder },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: Colors.text },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: Colors.textMuted, marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: Colors.surface, paddingHorizontal: 14, paddingVertical: Tokens.spacing.sm, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: Colors.cardBorder, fontSize: Type.subhead.fontSize, color: Colors.text },
  multilineInput: { minHeight: 70 },
  modalFoot: { padding: Tokens.spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Tokens.spacing.xs, backgroundColor: Colors.primary, paddingVertical: 14, borderRadius: Tokens.radius.card },
  saveBtnText: { color: '#FFF', fontSize: Type.subhead.fontSize, fontWeight: '700' as const },
});
