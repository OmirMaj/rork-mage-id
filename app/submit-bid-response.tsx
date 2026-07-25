// submit-bid-response — contractor side of the homeowner RFP flow.
// Inserts a row into bid_responses tied to the RFP, optionally with a
// "request to view site first" flag (which suppresses estimate fields
// since they can't price it sight-unseen).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, ActivityIndicator,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Send, DollarSign, MessageSquare, Eye,
  AlertTriangle, FileText, Check, CheckCircle2, Lock, ArrowRight,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCompanies } from '@/contexts/CompaniesContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { generateUUID } from '@/utils/generateId';
import { generateInstantBid, recommendedTierOf } from '@/utils/instantBid';
import { recordPrediction } from '@/utils/brain/predictionLedger';
import { useLaborCostSamples } from '@/hooks/useLaborRates';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import type { TieredProposal, ProposalTierKey } from '@/types';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// Free/Pro contractors get a monthly cap on marketplace bid responses;
// Business+ (the 'unlimited_bid_responses' FeatureKey) is uncapped. There
// is no bid-response entry in the shared FEATURE_LIMITS table yet, so the
// free cap lives here — see FLAG in the work-order report: this constant
// ideally belongs in hooks/useTierAccess.ts FEATURE_LIMITS alongside
// post_community_bid so client + server stay in sync.
const FREE_MONTHLY_BID_RESPONSES = 3;
const BID_RESPONSE_USAGE_KEY = 'mageid_bid_responses_usage';

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function getBidResponsesThisMonth(userId: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(BID_RESPONSE_USAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, { month: string; count: number }>) : {};
    const entry = map[userId];
    if (!entry || entry.month !== currentMonthKey()) return 0;
    return entry.count;
  } catch {
    return 0;
  }
}

async function bumpBidResponsesThisMonth(userId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(BID_RESPONSE_USAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, { month: string; count: number }>) : {};
    const month = currentMonthKey();
    const entry = map[userId];
    map[userId] = entry && entry.month === month
      ? { month, count: entry.count + 1 }
      : { month, count: 1 };
    await AsyncStorage.setItem(BID_RESPONSE_USAGE_KEY, JSON.stringify(map));
  } catch {
    // Best-effort — never block a submitted bid on the local counter.
  }
}

interface RfpRow {
  id: string;
  title: string;
  user_id: string;
  status: string;
  is_homeowner_rfp: boolean;
  city: string | null;
  state: string | null;
  category: string | null;
  scope_description: string | null;
  budget_min: number | null;
  budget_max: number | null;
}

export default function SubmitBidResponseScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { companies } = useCompanies();
  const { settings, addLead, projects, getCommitmentsForProject } = useProjects() as any;
  const { canAccess } = useTierAccess();
  const { bidId } = useLocalSearchParams<{ bidId: string }>();

  // Business+ ('unlimited_bid_responses') bids without limit; everyone
  // else is capped per calendar month. This is the marketplace's core
  // monetization lever — high-intent contractors upgrade to keep bidding.
  const unlimitedBids = canAccess('unlimited_bid_responses');
  const [usedThisMonth, setUsedThisMonth] = useState(0);
  useEffect(() => {
    if (!user?.id || unlimitedBids) return;
    let cancelled = false;
    void getBidResponsesThisMonth(user.id).then(n => { if (!cancelled) setUsedThisMonth(n); });
    return () => { cancelled = true; };
  }, [user?.id, unlimitedBids]);
  const atMonthlyCap = !unlimitedBids && usedThisMonth >= FREE_MONTHLY_BID_RESPONSES;

  // Only one company per user for now — first one wins (most apps have a single org).
  const company = useMemo(() => companies[0], [companies]);

  // Self-perform labor samples (D6) — folds crew hours × configured loaded
  // rates into the cost book that grounds the instant-bid ROM.
  const laborSamples = useLaborCostSamples();
  const { receipts } = useMaterialReceipts();

  const [estimateAmount, setEstimateAmount]   = useState('');
  const [estimateSummary, setEstimateSummary] = useState('');
  const [message, setMessage]                 = useState('');
  const [viewSiteFirst, setViewSiteFirst]     = useState(false);
  const [submitting, setSubmitting]           = useState(false);
  const [error, setError]                     = useState<string | null>(null);

  // ── Instant Bid state ──
  const [proposal, setProposal]         = useState<TieredProposal | null>(null);
  const [selectedTier, setSelectedTier] = useState<ProposalTierKey>('better');
  const [generating, setGenerating]     = useState(false);

  const { data: rfp, isLoading } = useQuery({
    queryKey: ['rfp-summary', bidId],
    enabled: !!bidId && isSupabaseConfigured,
    queryFn: async (): Promise<RfpRow | null> => {
      const { data, error: e } = await supabase
        .from('public_bids')
        .select('id,title,user_id,status,is_homeowner_rfp,city,state,category,scope_description,budget_min,budget_max')
        .eq('id', bidId).single();
      if (e) return null;
      return data;
    },
  });

  // Generate a Good/Better/Best draft from the RFP in one tap. Fills the
  // amount/summary/message fields from the recommended tier so the contractor
  // can review + tweak, then send. Speed-to-lead made literal.
  const handleInstantBid = useCallback(async () => {
    if (!rfp) return;
    setError(null);
    setGenerating(true);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const allCommitments = Array.isArray(projects)
        ? (projects as Array<{ id: string }>).flatMap((p) => {
            try { return (getCommitmentsForProject(p.id) ?? []) as unknown[]; } catch { return []; }
          })
        : [];
      const p = await generateInstantBid(
        {
          title: rfp.title,
          city: rfp.city,
          state: rfp.state,
          scopeDescription: rfp.scope_description,
          budgetMin: rfp.budget_min,
          budgetMax: rfp.budget_max,
          projectType: rfp.category,
        },
        {
          companyName: company?.companyName,
          financing: settings?.financing,
          contractorNote: message.trim() || undefined,
          groundingContext:
            Array.isArray(projects) && projects.length > 0
              ? { projects: projects as import('@/types').Project[], commitments: allCommitments as import('@/types').Commitment[], receipts, laborSamples }
              : undefined,
        },
      );
      setProposal(p);
      setSelectedTier(p.recommendedTier);
      setViewSiteFirst(false);
      const rec = recommendedTierOf(p);
      setEstimateAmount(String(rec.amount));
      setEstimateSummary(rec.inclusions.slice(0, 3).join(' · '));
      setMessage(p.message);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('[instant-bid] generation failed', e);
      setError('Could not draft a bid right now. You can still fill it in manually below.');
    } finally {
      setGenerating(false);
    }
  }, [rfp, company, settings, message]);

  // Picking a different tier re-fills the amount/summary from that tier.
  const handlePickTier = useCallback((key: ProposalTierKey) => {
    if (!proposal) return;
    const tier = proposal.tiers.find(t => t.key === key);
    if (!tier) return;
    setSelectedTier(key);
    setEstimateAmount(String(tier.amount));
    setEstimateSummary(tier.inclusions.slice(0, 3).join(' · '));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [proposal]);

  const validate = useCallback((): string | null => {
    if (!viewSiteFirst) {
      if (!estimateAmount || Number(estimateAmount) <= 0) return 'Enter a non-zero estimate amount.';
      if (!estimateSummary.trim()) return 'Add a one-line summary of what your estimate covers.';
    }
    if (!message.trim() || message.trim().length < 20) return 'Add a brief message — what makes you a good fit, when you can start, etc.';
    return null;
  }, [viewSiteFirst, estimateAmount, estimateSummary, message]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    const v = validate();
    if (v) { setError(v); return; }
    if (!user || !bidId || !rfp) return;

    if (rfp.user_id === user.id) {
      setError('You can\'t submit a bid on your own RFP.');
      return;
    }
    if (rfp.status !== 'open' || !rfp.is_homeowner_rfp) {
      setError('This project isn\'t accepting bids.');
      return;
    }

    // Tier gate — Business+ bids without limit; free/Pro hit a monthly cap.
    // Re-read the counter at submit-time (not just on mount) so rapid
    // back-to-back bids can't slip past a stale in-state count.
    if (!unlimitedBids) {
      const used = await getBidResponsesThisMonth(user.id);
      setUsedThisMonth(used);
      if (used >= FREE_MONTHLY_BID_RESPONSES) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          'Monthly bid limit reached',
          `You've sent your ${FREE_MONTHLY_BID_RESPONSES} bids for this month. Upgrade to Business for unlimited marketplace bidding.`,
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'See plans', onPress: () => router.push('/paywall' as never) },
          ],
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const proposerName = company?.companyName ?? user.name ?? user.email ?? 'Anonymous contractor';
      const proposerEmail = company?.contactEmail ?? user.email ?? null;
      const proposerPhone = company?.phone ?? null;

      // When the bid came from the Instant Bid generator we persist the full
      // Good/Better/Best proposal in estimate_breakdown (a jsonb column that
      // was previously unused — no schema change). bid_amount mirrors the
      // selected tier so the existing review/award screens, which read
      // bid_amount, keep working unchanged.
      //
      // Route the insert through the offline queue (supabaseWrite) so a bid
      // submitted on flaky jobsite connectivity is retried on reconnect
      // rather than silently lost — matching the rest of the app. An
      // explicit id keeps the queued write idempotent.
      const responseId = generateUUID();
      const ok = await supabaseWrite('bid_responses', 'insert', {
        id: responseId,
        bid_id: bidId,
        user_id: user.id,
        proposer_company_id: company?.id ?? null,
        company_name: proposerName,            // canonical column on the table
        proposer_email: proposerEmail,
        proposer_phone: proposerPhone,
        bid_amount: viewSiteFirst ? null : Number(estimateAmount),
        estimate_summary: viewSiteFirst ? 'Site visit requested before final estimate.' : estimateSummary.trim(),
        estimate_breakdown: proposal ?? null,
        scope_description: message.trim(),
        view_site_requested: viewSiteFirst,
        status: 'submitted',
      });
      // supabaseWrite returns true ONLY on an immediately-accepted write. It
      // returns false for a not-configured build, an offline-queued write
      // (retried on reconnect), AND a dropped non-network failure (RLS /
      // validation / 500 — already toasted inside supabaseWrite). The boolean
      // can't distinguish queued from dropped, so treat a non-accepted write as
      // "not confirmed": don't burn a monthly bid, don't create a lead, and
      // don't show a false "Bid submitted" success.
      // (Prev bug: `ok || isSupabaseConfigured` was always true in real builds,
      // so a DROPPED bid still decremented the free allowance and showed
      // success — permanently locking the contractor out of bidding.)
      if (!ok) {
        setError(
          "We couldn't confirm your bid was sent. If you're offline it'll send " +
          'automatically when you reconnect — otherwise please try again.',
        );
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      await bumpBidResponsesThisMonth(user.id);
      setUsedThisMonth(n => n + 1);

      // G4: fire-and-forget capture — only when bid confirmed (ok=true)
      if (proposal) {
        try {
          recordPrediction(
            'instant_bid_sent',
            responseId,
            {
              responseId,
              basis: proposal.basis,
              groundingRateCount: proposal.groundingRateCount ?? 0,
              tierAmounts: proposal.tiers.map(t => ({ key: t.key, amount: t.amount })),
            },
          );
        } catch { /* G4 */ }
      }

      // Auto-create a CRM lead so the contractor's pipeline + speed-to-lead
      // metrics reflect marketplace activity. firstRespondedAt = now because
      // responding to the RFP *is* the first response. This is what turns a
      // portal bid into a tracked, win-rate-counted lead.
      try {
        addLead({
          name: rfp.title,
          source: 'mage_bids',
          stage: viewSiteFirst ? 'qualified' : 'proposal',
          address: [rfp.city, rfp.state].filter(Boolean).join(', ') || undefined,
          projectType: rfp.category ?? undefined,
          scope: rfp.scope_description ?? undefined,
          budgetMin: rfp.budget_min ?? undefined,
          budgetMax: rfp.budget_max ?? undefined,
          firstRespondedAt: new Date().toISOString(),
          touches: [{
            id: `t-${Date.now()}`,
            kind: 'note',
            body: viewSiteFirst
              ? 'Requested a site visit via MAGE ID Bids.'
              : `Submitted ${proposal ? 'an Instant Bid' : 'a bid'} of ${formatMoney(Number(estimateAmount) || 0)} via MAGE ID Bids.`,
            occurredAt: new Date().toISOString(),
          }],
        });
      } catch (leadErr) {
        // Lead creation is best-effort — never block the bid on it.
        console.warn('[submit-bid-response] lead create failed', leadErr);
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Bid submitted',
        viewSiteFirst
          ? 'The homeowner will see your site-visit request and reach out if they want to schedule. We added it to your Leads pipeline.'
          : 'The homeowner will review your estimate. You\'ll be notified if they shortlist or award you. We added it to your Leads pipeline.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e) {
      console.warn('[submit-bid-response] failed', e);
      setError(String((e as Error).message ?? e));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  }, [validate, user, bidId, rfp, company, viewSiteFirst, estimateAmount, estimateSummary, message, proposal, addLead, router, unlimitedBids]);

  if (isLoading || !rfp) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="small" color={themeColors.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Submit your bid</Text>
          <Text style={styles.title} numberOfLines={2}>{rfp.title}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Instant Bid — one-tap AI-drafted Good/Better/Best proposal */}
        <View style={styles.instantCard}>
          <View style={styles.instantHead}>
            <View style={styles.instantIcon}><MageAIMark size={16} color="#FFF" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.instantTitle}>Instant Bid</Text>
              <Text style={styles.instantSub}>
                Draft a professional Good / Better / Best proposal in seconds. The first pro to respond wins the most jobs.
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.instantBtn, generating && styles.instantBtnDisabled]}
            onPress={handleInstantBid}
            disabled={generating}
            activeOpacity={0.85}
            testID="instant-bid-generate"
          >
            {generating ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <MageAIMark size={15} color="#FFF" />
                <Text style={styles.instantBtnText}>{proposal ? 'Regenerate draft' : 'Draft my bid'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Tier picker — appears once a draft exists */}
        {proposal && !viewSiteFirst && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Choose the option to send</Text>
            <Text style={styles.helper}>
              Offering a range lifts win-rates — the &quot;Recommended&quot; tier is pre-selected. Tap to switch.
            </Text>
            <View style={styles.tierList}>
              {proposal.tiers.map(tier => {
                const active = tier.key === selectedTier;
                return (
                  <TouchableOpacity
                    key={tier.key}
                    style={[styles.tierCard, active && styles.tierCardActive]}
                    onPress={() => handlePickTier(tier.key)}
                    activeOpacity={0.85}
                    testID={`instant-bid-tier-${tier.key}`}
                  >
                    <View style={styles.tierTop}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.tierLabelRow}>
                          <Text style={[styles.tierLabel, active && { color: themeColors.accent }]}>{tier.label}</Text>
                          {tier.key === proposal.recommendedTier && (
                            <View style={styles.tierBadge}><Text style={styles.tierBadgeText}>RECOMMENDED</Text></View>
                          )}
                        </View>
                        <Text style={styles.tierTagline}>{tier.tagline}</Text>
                      </View>
                      <View style={[styles.tierRadio, active && styles.tierRadioActive]}>
                        {active && <Check size={12} color="#FFF" strokeWidth={1.75} />}
                      </View>
                    </View>
                    <Text style={styles.tierAmount}>{formatMoney(tier.amount)}</Text>
                    {tier.financingLine ? <Text style={styles.tierFinancing}>{tier.financingLine}</Text> : null}
                    <View style={styles.tierIncl}>
                      {tier.inclusions.slice(0, 4).map((inc, i) => (
                        <View key={i} style={styles.tierInclRow}>
                          <CheckCircle2 size={11} color={themeColors.success} strokeWidth={1.75} />
                          <Text style={styles.tierInclText} numberOfLines={1}>{inc}</Text>
                        </View>
                      ))}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.tierNote}>
              {proposal.basis === 'history' && proposal.groundingRateCount
                ? `Anchored on your last ${proposal.groundingRateCount} learned rate${proposal.groundingRateCount === 1 ? '' : 's'}. Review before sending.`
                : proposal.basis === 'budget'
                  ? 'Blended toward the posted budget. Review before sending.'
                  : 'Rough AI guess — no budget or cost history to anchor this. Review carefully before sending.'}
            </Text>
          </View>
        )}

        {/* Site visit toggle */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Need to walk the site first?</Text>
          <Text style={styles.helper}>
            Toggle on if you can&apos;t price the work without seeing it. The homeowner will see this
            request and decide whether to invite you over before deciding.
          </Text>
          <TouchableOpacity
            style={[styles.toggleRow, viewSiteFirst && styles.toggleRowActive]}
            onPress={() => setViewSiteFirst(v => !v)}
            activeOpacity={0.85}
          >
            <Eye size={16} color={viewSiteFirst ? themeColors.accent : themeColors.textMuted} strokeWidth={1.75} />
            <Text style={[styles.toggleText, viewSiteFirst && styles.toggleTextActive]}>
              {viewSiteFirst ? 'Requesting a site visit before quoting' : 'Request site visit before quoting'}
            </Text>
            <View style={[styles.toggleDot, viewSiteFirst && styles.toggleDotActive]} />
          </TouchableOpacity>
        </View>

        {!viewSiteFirst && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Estimate amount *</Text>
            <View style={styles.amountField}>
              <DollarSign size={16} color={themeColors.textMuted} strokeWidth={1.75} />
              <TextInput
                style={styles.amountInput}
                value={estimateAmount}
                onChangeText={setEstimateAmount}
                placeholder="0"
                placeholderTextColor={themeColors.textMuted}
                keyboardType="numeric"
              />
            </View>

            <Text style={[styles.cardLabel, { marginTop: 14 }]}>One-line summary *</Text>
            <Text style={styles.helper}>What does this estimate cover? E.g. &quot;Cabinets + counters + install, materials sourced.&quot;</Text>
            <TextInput
              style={styles.input}
              value={estimateSummary}
              onChangeText={setEstimateSummary}
              placeholder="Materials + labor + permits, 6-week timeline"
              placeholderTextColor={themeColors.textMuted}
              maxLength={140}
            />
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Message to the homeowner *</Text>
          <Text style={styles.helper}>
            Why are you a fit, what&apos;s included, when can you start, references? This is your pitch.
          </Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={message}
            onChangeText={setMessage}
            placeholder="Hey — I'm a residential GC in your area with 12 years on remodels. I'd handle..."
            placeholderTextColor={themeColors.textMuted}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{message.length} chars</Text>
        </View>

        {/* Identity preview */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Submitting as</Text>
          <View style={styles.identityRow}>
            <FileText size={14} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.identityText}>
              {company?.companyName ?? user?.name ?? user?.email ?? 'Anonymous'}
              {company?.city && company?.state ? ` · ${company.city}, ${company.state}` : ''}
            </Text>
          </View>
          {!company && (
            <Text style={styles.identityHelper}>
              Tip: add a company profile in Settings → Companies so the homeowner sees a verified pitch.
            </Text>
          )}
        </View>

        {error && (
          <View style={styles.errorCard}>
            <AlertTriangle size={16} color={themeColors.danger} strokeWidth={1.75} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Tier meter — free/Pro see remaining bids this month; Business+
            bids without limit so we show nothing. At the cap, this becomes
            an upgrade prompt. */}
        {!unlimitedBids && (
          atMonthlyCap ? (
            <TouchableOpacity
              style={styles.capCard}
              onPress={() => router.push('/paywall' as never)}
              activeOpacity={0.85}
            >
              <Lock size={16} color={themeColors.accent} strokeWidth={1.75} />
              <View style={{ flex: 1 }}>
                <Text style={styles.capTitle}>You&apos;ve used your {FREE_MONTHLY_BID_RESPONSES} bids this month</Text>
                <Text style={styles.capSub}>Upgrade to Business for unlimited marketplace bidding.</Text>
              </View>
              <ArrowRight size={16} color={themeColors.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          ) : (
            <Text style={styles.usageLine}>
              {Math.max(0, FREE_MONTHLY_BID_RESPONSES - usedThisMonth)} of {FREE_MONTHLY_BID_RESPONSES} free bids left this month
            </Text>
          )
        )}

        <TouchableOpacity
          style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
          onPress={atMonthlyCap ? () => router.push('/paywall' as never) : handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : atMonthlyCap ? (
            <>
              <Lock size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.submitBtnText}>Upgrade to bid</Text>
            </>
          ) : (
            <>
              {viewSiteFirst ? <MessageSquare size={16} color="#FFF" strokeWidth={1.75} /> : <Send size={16} color="#FFF" strokeWidth={1.75} />}
              <Text style={styles.submitBtnText}>
                {viewSiteFirst ? 'Send site-visit request' : 'Send bid'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          Submitting binds you to honor the estimate if the homeowner accepts. You can withdraw any
          time before they award the project.
        </Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.4, marginTop: 4 },

  card: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: t.line, marginBottom: 12,
  },
  cardLabel: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  helper: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginBottom: 10, lineHeight: 17 },
  charCount: { fontSize: Type.caption2.fontSize, color: t.textMuted, alignSelf: 'flex-end', marginTop: 4 },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: t.bg, borderRadius: Tokens.radius.md,
    padding: 14, borderWidth: 1.5, borderColor: t.line,
  },
  toggleRowActive: { borderColor: t.accent, backgroundColor: t.accent + '08' },
  toggleText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' },
  toggleTextActive: { color: t.accent },
  toggleDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: t.bg, borderWidth: 1.5, borderColor: t.line },
  toggleDotActive: { backgroundColor: t.accent, borderColor: t.accent },

  amountField: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.bg, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  amountInput: { flex: 1, fontSize: Type.title2.fontSize, fontWeight: '800', color: t.text },

  input: {
    backgroundColor: t.bg, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: Type.bodyCompact.fontSize, color: t.text,
  },
  inputMultiline: { minHeight: 120, paddingTop: 11 },

  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  identityText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' },
  identityHelper: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 8, fontStyle: 'italic', lineHeight: 16 },

  errorCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 14, borderRadius: Tokens.radius.card,
    backgroundColor: t.danger + '0D',
    borderWidth: 1, borderColor: t.danger + '30',
    marginBottom: 12,
  },
  errorText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.danger, lineHeight: 18 },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: Tokens.radius.card,
    backgroundColor: t.accent,
    shadowColor: t.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: '#FFF', letterSpacing: 0.2 },

  capCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderRadius: Tokens.radius.card,
    backgroundColor: t.accent + '0D',
    borderWidth: 1, borderColor: t.accent + '33',
    marginBottom: 12,
  },
  capTitle: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: t.text },
  capSub: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2, lineHeight: 16 },
  usageLine: {
    fontSize: Type.caption1.fontSize, fontWeight: '600', color: t.textMuted,
    textAlign: 'center', marginBottom: 10,
  },

  disclaimer: { fontSize: Type.caption2.fontSize, color: t.textMuted, textAlign: 'center', marginTop: 14, fontStyle: 'italic', paddingHorizontal: 16, lineHeight: 16 },

  // ── Instant Bid ──
  instantCard: {
    borderRadius: Tokens.radius.lg, padding: 14, marginBottom: 12,
    backgroundColor: t.accent + '0E', borderWidth: 1, borderColor: t.accent + '33',
  },
  instantHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  instantIcon: {
    width: 32, height: 32, borderRadius: 9, backgroundColor: t.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  instantTitle: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  instantSub: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 16, marginTop: 2 },
  instantBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 12, borderRadius: Tokens.radius.md, backgroundColor: t.accent,
  },
  instantBtnDisabled: { opacity: 0.6 },
  instantBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: '#FFF', letterSpacing: 0.2 },

  tierList: { gap: 10, marginTop: 4 },
  tierCard: {
    backgroundColor: t.bg, borderRadius: Tokens.radius.md, padding: 12,
    borderWidth: 1.5, borderColor: t.line,
  },
  tierCardActive: { borderColor: t.accent, backgroundColor: t.accent + '08' },
  tierTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tierLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  tierLabel: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: t.text },
  tierBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: Tokens.radius.full, backgroundColor: t.accent },
  tierBadgeText: { fontSize: 8, fontWeight: '800', color: '#FFF', letterSpacing: 0.6 },
  tierTagline: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2, lineHeight: 15 },
  tierRadio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: t.line,
    alignItems: 'center', justifyContent: 'center',
  },
  tierRadioActive: { backgroundColor: t.accent, borderColor: t.accent },
  tierAmount: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, marginTop: 8, letterSpacing: -0.4 },
  tierFinancing: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '700', marginTop: 2 },
  tierIncl: { gap: 4, marginTop: 8 },
  tierInclRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tierInclText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text },
  tierNote: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontStyle: 'italic', marginTop: 10, lineHeight: 15 },
});
