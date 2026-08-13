// InstantBidProposalModal — draft an Instant Bid proposal for one of the
// contractor's OWN leads/clients (not a marketplace RFP). This is the
// day-one "aha": import your book of business → tap a client → get a
// polished Good/Better/Best proposal in seconds, before any marketplace
// liquidity exists. Reuses utils/instantBid (AI ROM + heuristic fallback,
// never hard-fails) so behavior matches the marketplace flow.
//
// "Mark proposal sent" logs a touch on the lead and advances it to the
// 'proposal' stage — keeping MAGE ID the system of record for the
// relationship (the anti-leakage moat).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Share,
  ActivityIndicator, Platform, TextInput,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Check, CheckCircle2, X, Share2 } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useCompanies } from '@/contexts/CompaniesContext';
import { generateInstantBid, recommendedTierOf } from '@/utils/instantBid';
import { useLaborCostSamples } from '@/hooks/useLaborRates';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useCostSeeds } from '@/hooks/useCostSeeds';
import type { Lead, TieredProposal, ProposalTierKey } from '@/types';
import { formatMoney, parseLenientNumber } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function InstantBidProposalModal({
  visible,
  onClose,
  lead,
}: {
  visible: boolean;
  onClose: () => void;
  lead: Lead | null;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { settings, addLeadTouch, updateLead, projects, getCommitmentsForProject } = useProjects() as any;
  const { companies } = useCompanies();
  const company = companies[0];
  // Self-perform labor samples (D6) — folds crew hours × configured loaded
  // rates into the cost book that grounds the ROM.
  const laborSamples = useLaborCostSamples();
  const { receipts } = useMaterialReceipts();
  // Cold-start seeds — and note the guard change below: this is the ONE screen
  // where a seeded contractor most likely has zero projects, so the old
  // "projects.length > 0" gate would have thrown their rates away.
  const { seeds } = useCostSeeds();

  const [proposal, setProposal] = useState<TieredProposal | null>(null);
  const [selectedTier, setSelectedTier] = useState<ProposalTierKey>('better');
  const [generating, setGenerating] = useState(false);
  const [sent, setSent] = useState(false);
  // "Ballpark you'd bid this at?" inline refine question — shown when the lead
  // has no budget hint and no cost history can ground the estimate.
  const [ballparkInput, setBallparkInput] = useState('');
  const [showBallparkPrompt, setShowBallparkPrompt] = useState(false);

  // Generation token: closing the sheet does NOT abort the in-flight
  // generateInstantBid promise, so without this a canceled run resurrected —
  // reopening later showed a fully-formed proposal built from a budget hint
  // the user closed the sheet to abandon, and overlapping runs could swap
  // the tier amounts between 'Share' and 'Mark proposal sent'. Every reset
  // bumps the token; a resolving run only commits if its token still matches.
  const runIdRef = useRef(0);

  const reset = useCallback(() => {
    runIdRef.current += 1; // invalidate any in-flight generation
    setProposal(null);
    setSelectedTier('better');
    setGenerating(false);
    setSent(false);
    setBallparkInput('');
    setShowBallparkPrompt(false);
  }, []);

  const handleClose = useCallback(() => { reset(); onClose(); }, [reset, onClose]);

  // Fresh state on every open and on lead change — a stale proposal for a
  // different lead (or an abandoned budget hint) must never greet the user.
  const leadId = lead?.id ?? null;
  useEffect(() => {
    if (visible) reset();
  }, [visible, leadId, reset]);

  // Collect all commitments across projects for cost-book grounding.
  const allCommitments = Array.isArray(projects)
    ? (projects as Array<{ id: string }>).flatMap((p) => {
        try {
          return (getCommitmentsForProject(p.id) ?? []) as unknown[];
        } catch {
          return [];
        }
      })
    : [];

  const doGenerate = useCallback(async (budgetHint?: number) => {
    // `generating` guard: the ballpark input's Enter key can race the
    // Generate button — never start overlapping runs.
    if (!lead || generating) return;
    const runId = ++runIdRef.current;
    setShowBallparkPrompt(false);
    setGenerating(true);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const rfp = {
        title: lead.projectType || `${lead.name} project`,
        city: lead.address ?? undefined,
        scopeDescription: lead.scope ?? undefined,
        budgetMin: budgetHint ?? lead.budgetMin ?? undefined,
        budgetMax: budgetHint ?? lead.budgetMax ?? undefined,
        projectType: lead.projectType ?? undefined,
      };
      // Seeds alone are enough to ground. A contractor who just pasted their
      // rate sheet and hasn't created a project yet is EXACTLY the cold start
      // seeding exists for — gating on projects.length would have silently
      // discarded the only real pricing data they have.
      const groundingContext =
        (Array.isArray(projects) && projects.length > 0) || seeds.length > 0
          ? { projects: (Array.isArray(projects) ? projects : []) as import('@/types').Project[], commitments: allCommitments as import('@/types').Commitment[], receipts, laborSamples, seeds }
          : undefined;
      const p = await generateInstantBid(rfp, {
        companyName: company?.companyName,
        financing: settings?.financing,
        groundingContext,
      });
      if (runId !== runIdRef.current) return; // aborted: closed / reopened / lead changed
      setProposal(p);
      setSelectedTier(p.recommendedTier);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // generateInstantBid never throws, but guard anyway.
    } finally {
      if (runId === runIdRef.current) setGenerating(false);
    }
  }, [lead, generating, company, settings, projects, allCommitments, receipts, laborSamples, seeds]);

  const handleGenerate = useCallback(async () => {
    if (!lead) return;
    // If no budget hint exists, ask the contractor one inline question before
    // generating so we don't send a raw AI guess to a real homeowner.
    const hasBudget = (lead.budgetMin != null && lead.budgetMin > 0) || (lead.budgetMax != null && lead.budgetMax > 0);
    if (!hasBudget) {
      setShowBallparkPrompt(true);
      return;
    }
    await doGenerate();
  }, [lead, doGenerate]);

  const handleBallparkConfirm = useCallback(async () => {
    const val = parseLenientNumber(ballparkInput);
    await doGenerate(val != null && val > 0 ? val : undefined);
  }, [ballparkInput, doGenerate]);

  const handleShare = useCallback(async () => {
    if (!proposal || !lead) return;
    const tier = proposal.tiers.find(t => t.key === selectedTier) ?? recommendedTierOf(proposal);
    const lines = [
      proposal.message,
      '',
      `${tier.label} — ${formatMoney(tier.amount)}`,
      ...tier.inclusions.map(i => `• ${i}`),
      tier.financingLine ? `\n${tier.financingLine}` : '',
    ].filter(Boolean);
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      /* cancelled */
    }
  }, [proposal, lead, selectedTier]);

  const handleMarkSent = useCallback(() => {
    if (!proposal || !lead) return;
    const tier = proposal.tiers.find(t => t.key === selectedTier) ?? recommendedTierOf(proposal);
    addLeadTouch(lead.id, 'email', `Sent Instant Bid proposal — ${tier.label} ${formatMoney(tier.amount)}.`);
    // Advance to 'proposal' if still earlier in the funnel (don't regress won/lost).
    if (lead.stage === 'new' || lead.stage === 'qualified') {
      updateLead(lead.id, { stage: 'proposal' });
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSent(true);
  }, [proposal, lead, selectedTier, addLeadTouch, updateLead]);

  if (!lead) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <View style={styles.headIcon}><MageAIMark size={16} color="#FFF" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Instant Bid</Text>
              <Text style={styles.sub} numberOfLines={1}>for {lead.name}</Text>
            </View>
            <TouchableOpacity onPress={handleClose} hitSlop={8}><X size={20} color={colors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
          </View>

          {sent ? (
            <View style={styles.sentWrap}>
              <View style={styles.sentIcon}><CheckCircle2 size={36} color={colors.success} strokeWidth={1.75} /></View>
              <Text style={styles.sentTitle}>Proposal logged</Text>
              <Text style={styles.sentBody}>
                {lead.name} is now in the Proposal stage and the send is on their timeline.
                Follow up in a few days if you don&apos;t hear back.
              </Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={handleClose} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : !proposal ? (
            <View style={styles.genWrap}>
              <Text style={styles.genBody}>
                Draft a professional Good / Better / Best proposal for {lead.name} in seconds —
                {lead.budgetMin || lead.budgetMax ? ' tuned to their budget' : ' from the scope on file'}.
              </Text>
              {showBallparkPrompt ? (
                <View style={styles.ballparkWrap}>
                  <Text style={styles.ballparkQuestion}>
                    Ballpark you&apos;d bid this at?
                  </Text>
                  <Text style={styles.ballparkHint}>
                    No budget was posted — a rough number helps anchor the estimate so the prices you send are closer to what you&apos;d actually charge.
                  </Text>
                  <TextInput
                    style={styles.ballparkInput}
                    value={ballparkInput}
                    onChangeText={setBallparkInput}
                    placeholder="e.g. $12,000"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={handleBallparkConfirm}
                    testID="lead-instant-bid-ballpark"
                  />
                  <View style={styles.ballparkActions}>
                    <TouchableOpacity
                      style={styles.ballparkSkip}
                      onPress={() => doGenerate()}
                      activeOpacity={0.75}
                    >
                      <Text style={styles.ballparkSkipText}>Skip — use AI estimate</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.primaryBtn, { flex: 1 }]}
                      onPress={handleBallparkConfirm}
                      disabled={generating}
                      activeOpacity={0.85}
                    >
                      {generating
                        ? <ActivityIndicator size="small" color="#FFF" />
                        : <Text style={styles.primaryBtnText}>Generate</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.primaryBtn, generating && styles.btnDisabled]}
                  onPress={handleGenerate}
                  disabled={generating}
                  activeOpacity={0.85}
                  testID="lead-instant-bid-generate"
                >
                  {generating
                    ? <ActivityIndicator size="small" color="#FFF" />
                    : <><MageAIMark size={15} color="#FFF" /><Text style={styles.primaryBtnText}>Draft proposal</Text></>}
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
              <View style={styles.tierList}>
                {proposal.tiers.map(tier => {
                  const active = tier.key === selectedTier;
                  return (
                    <TouchableOpacity
                      key={tier.key}
                      style={[styles.tierCard, active && styles.tierCardActive]}
                      onPress={() => { setSelectedTier(tier.key); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
                      activeOpacity={0.85}
                      testID={`lead-bid-tier-${tier.key}`}
                    >
                      <View style={styles.tierTop}>
                        <View style={{ flex: 1 }}>
                          <View style={styles.tierLabelRow}>
                            <Text style={[styles.tierLabel, active && { color: colors.accent }]}>{tier.label}</Text>
                            {tier.key === proposal.recommendedTier && (
                              <View style={styles.tierBadge}><Text style={styles.tierBadgeText}>RECOMMENDED</Text></View>
                            )}
                          </View>
                          <Text style={styles.tierTagline}>{tier.tagline}</Text>
                        </View>
                        <View style={[styles.radio, active && styles.radioActive]}>{active && <Check size={12} color="#FFF" strokeWidth={1.75} />}</View>
                      </View>
                      <Text style={styles.tierAmount}>{formatMoney(tier.amount)}</Text>
                      {tier.financingLine ? <Text style={styles.tierFinancing}>{tier.financingLine}</Text> : null}
                      <View style={styles.tierIncl}>
                        {tier.inclusions.slice(0, 4).map((inc, i) => (
                          <View key={i} style={styles.inclRow}>
                            <CheckCircle2 size={11} color={colors.success} strokeWidth={1.75} />
                            <Text style={styles.inclText} numberOfLines={1}>{inc}</Text>
                          </View>
                        ))}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.85} testID="lead-bid-share">
                  <Share2 size={15} color={colors.accent} strokeWidth={1.75} />
                  <Text style={styles.shareBtnText}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }]} onPress={handleMarkSent} activeOpacity={0.85} testID="lead-bid-mark-sent">
                  <Check size={16} color="#FFF" strokeWidth={1.75} />
                  <Text style={styles.primaryBtnText}>Mark proposal sent</Text>
                </TouchableOpacity>
              </View>
              {proposal.basis === 'history' && proposal.groundingRateCount ? (
                <Text style={styles.noteGrounded}>
                  Anchored on your last {proposal.groundingRateCount} learned rate{proposal.groundingRateCount === 1 ? '' : 's'} from similar jobs.
                </Text>
              ) : proposal.basis === 'budget' ? (
                <Text style={styles.note}>Blended toward the budget range provided.</Text>
              ) : (
                <Text style={styles.noteWarning}>
                  Rough AI guess — no budget or cost history to anchor this. Review the numbers before sending.
                </Text>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 18, paddingBottom: 34, maxHeight: '88%',
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center', marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  headIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: t.text },
  sub: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 1 },

  genWrap: { gap: 14, paddingVertical: 8 },
  genBody: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 20 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 13, borderRadius: Tokens.radius.card, backgroundColor: t.accent,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: '#FFF' },

  tierList: { gap: 10 },
  tierCard: { backgroundColor: t.bg, borderRadius: Tokens.radius.md, padding: 12, borderWidth: 1.5, borderColor: t.line },
  tierCardActive: { borderColor: t.accent, backgroundColor: t.accent + '08' },
  tierTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tierLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  tierLabel: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: t.text },
  tierBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: Tokens.radius.full, backgroundColor: t.accent },
  tierBadgeText: { fontSize: 8, fontWeight: '800', color: '#FFF', letterSpacing: 0.6 },
  tierTagline: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2, lineHeight: 15 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: t.line, alignItems: 'center', justifyContent: 'center' },
  radioActive: { backgroundColor: t.accent, borderColor: t.accent },
  tierAmount: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, marginTop: 8, letterSpacing: -0.4 },
  tierFinancing: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '700', marginTop: 2 },
  tierIncl: { gap: 4, marginTop: 8 },
  inclRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  inclText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 13, borderRadius: Tokens.radius.card,
    backgroundColor: t.accent + '12', borderWidth: 1, borderColor: t.accent + '30',
  },
  shareBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.accent },
  note: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontStyle: 'italic', marginTop: 10, textAlign: 'center' },
  noteGrounded: { fontSize: Type.caption2.fontSize, color: t.success, fontStyle: 'italic', marginTop: 10, textAlign: 'center' },
  noteWarning: { fontSize: Type.caption2.fontSize, color: Colors.warning, fontStyle: 'italic', marginTop: 10, textAlign: 'center' },

  // Ballpark refine question — shown before generating when no budget hint exists.
  ballparkWrap: { gap: 10, paddingVertical: 4 },
  ballparkQuestion: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  ballparkHint: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17 },
  ballparkInput: {
    borderWidth: 1.5, borderColor: t.accent, borderRadius: Tokens.radius.sm,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: Type.subhead.fontSize,
    color: t.text, backgroundColor: t.bg,
  },
  ballparkActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ballparkSkip: { paddingVertical: 13, paddingHorizontal: 4 },
  ballparkSkipText: { fontSize: Type.caption1.fontSize, color: t.textMuted, textDecorationLine: 'underline' },

  sentWrap: { alignItems: 'center', gap: 10, paddingVertical: 20 },
  sentIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: t.success + '15', alignItems: 'center', justifyContent: 'center' },
  sentTitle: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text },
  sentBody: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 300 },
});
