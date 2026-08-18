// smart-proposal.tsx — turn an estimate into a client-ready good/better/best
// proposal, priced by the Win Optimizer.
//
// The GC enters (or prefills) the job cost, links a Lead, and gets three
// tiers — Essential / Signature / Premium — each priced off the optimizer's
// expected-value curve. Sharing sends a CLIENT-SAFE plain-text version
// (prices + inclusions only; win odds, expected profit, and markup stay
// in-app, clearly labeled internal). Marking the proposal accepted/declined
// flips the linked Lead to won/lost, which is exactly the history that
// trains the optimizer's win curve — the close-the-deal learning loop.
//
// Open with ?projectId to price that job's estimate, ?leadId to pre-link a
// lead, or standalone. Pro-gated like the rest of the cost-intelligence suite.

import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import {
  ChevronLeft, FileSignature, Share2, CheckCircle2, XCircle, Lock, Star, Check, User,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import {
  buildProposalTiers, proposalToShareText,
  type ProposalTier, type ProposalTierKey, type SmartProposal,
} from '@/utils/proposalBuilder';
import { useSmartProposals } from '@/hooks/useSmartProposals';
import { formatMoney } from '@/utils/formatters';
import { generateUUID } from '@/utils/generateId';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

export default function SmartProposalScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return (
      <Paywall
        visible={true}
        feature="Smart Proposal"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <SmartProposalInner />;
}

/** globalMarkup may be stored as a fraction (0.18) or a percent (18). Normalize to a percent for the input. */
function markupToPercent(globalMarkup: number | undefined): number {
  if (!globalMarkup || !Number.isFinite(globalMarkup)) return 18;
  return globalMarkup > 1 ? Math.round(globalMarkup) : Math.round(globalMarkup * 100);
}

const STATUS_LABEL: Record<SmartProposal['status'], string> = {
  draft: 'Draft',
  sent: 'Sent — awaiting answer',
  accepted: 'Accepted',
  declined: 'Declined',
};

function SmartProposalInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projectId, leadId } = useLocalSearchParams<{ projectId?: string; leadId?: string }>();
  const { getProject, leads, updateLead } = useProjects();
  const { addProposal, updateProposal } = useSmartProposals();

  const project = useMemo(() => (projectId ? getProject(projectId) : null), [projectId, getProject]);

  // Prefill from the project's linked estimate: baseTotal is the cost BEFORE
  // markup — exactly the cost basis the optimizer prices over.
  const prefillCost = project?.linkedEstimate?.baseTotal ?? 0;
  const prefillMarkupPct = markupToPercent(project?.linkedEstimate?.globalMarkup);

  const [costStr, setCostStr] = useState(prefillCost > 0 ? String(Math.round(prefillCost)) : '');
  const [markupStr, setMarkupStr] = useState(String(prefillMarkupPct));
  const [competitorsStr, setCompetitorsStr] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(leadId ?? null);
  const selectedLead = useMemo(
    () => (selectedLeadId ? leads.find(l => l.id === selectedLeadId) ?? null : null),
    [selectedLeadId, leads],
  );
  const [clientNameStr, setClientNameStr] = useState('');
  const clientName = clientNameStr.trim() || selectedLead?.name || '';

  // Open leads only for the picker — a proposal against an already-decided
  // lead would double-count the outcome in the win curve.
  const pickableLeads = useMemo(
    () => leads.filter(l => l.stage !== 'won' && l.stage !== 'lost').slice(0, 12),
    [leads],
  );

  const cost = Math.max(0, parseFloat(costStr.replace(/[^0-9.]/g, '')) || 0);
  const typicalMarkup = Math.max(0, (parseFloat(markupStr) || 0) / 100);
  const competitorCount = Math.max(0, parseInt(competitorsStr, 10) || 0);

  const built = useMemo(() => {
    if (cost <= 0) return null;
    return buildProposalTiers({
      cost,
      leads,
      typicalMarkup: typicalMarkup > 0 ? typicalMarkup : 0.18,
      competitorCount,
      clientName,
      projectName: project?.name,
    });
  }, [cost, leads, typicalMarkup, competitorCount, clientName, project?.name]);

  const [selectedTierKey, setSelectedTierKey] = useState<ProposalTierKey>('signature');
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [status, setStatus] = useState<SmartProposal['status']>('draft');

  /** Create or update the persisted proposal record with the current inputs. */
  const persistProposal = (nextStatus: SmartProposal['status'], tierKey?: ProposalTierKey): SmartProposal | null => {
    if (!built) return null;
    const now = new Date().toISOString();
    const record: SmartProposal = {
      id: proposalId ?? generateUUID(),
      projectId: project?.id,
      leadId: selectedLead?.id,
      clientName: clientName || 'Client',
      projectName: project?.name,
      tiers: built.tiers,
      selectedTierKey: tierKey ?? selectedTierKey,
      status: nextStatus,
      createdAt: now,
      updatedAt: now,
    };
    if (proposalId) {
      updateProposal(proposalId, {
        clientName: record.clientName, projectName: record.projectName,
        leadId: record.leadId, projectId: record.projectId,
        tiers: record.tiers, selectedTierKey: record.selectedTierKey, status: nextStatus,
      });
    } else {
      addProposal(record);
      setProposalId(record.id);
    }
    setStatus(nextStatus);
    return record;
  };

  const handleShare = async () => {
    if (!built) return;
    // Persist the current inputs WITHOUT advancing the status, so the record
    // exists to share from. Only flip to "sent" once the OS Share sheet
    // reports the user actually shared — cancelling/dismissing must NOT mark
    // the proposal sent.
    const record = persistProposal(status);
    if (!record) return;
    try {
      const result = await Share.share({ message: proposalToShareText(record) });
      if (result.action === Share.sharedAction && status === 'draft') {
        persistProposal('sent');
      }
    } catch (err) {
      console.warn('[smartProposal] share failed:', err);
    }
  };

  const closeLead = (stage: 'won' | 'lost', lostReason?: string) => {
    // Close the learning loop: the lead outcome is the training signal for
    // the Win Optimizer's curve.
    if (selectedLead) {
      updateLead(selectedLead.id, stage === 'won' ? { stage } : { stage, lostReason });
    }
  };

  const handleAccept = () => {
    if (!built) return;
    persistProposal('accepted');
    closeLead('won');
  };

  const handleDecline = () => {
    if (!built) return;
    showAlert(
      'Mark declined',
      'What was the dealbreaker? Tagging price-driven losses sharpens the next recommendation.',
      [
        { text: 'Price', onPress: () => { persistProposal('declined'); closeLead('lost', 'price'); } },
        { text: 'Other', onPress: () => { persistProposal('declined'); closeLead('lost', 'other'); } },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const statusColor =
    status === 'accepted' ? t.success : status === 'declined' ? t.danger : status === 'sent' ? t.accent : t.textMuted;
  const decided = status === 'accepted' || status === 'declined';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Smart Proposal · MAGE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{project?.name ?? 'Good / better / best'}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Inputs */}
        <View style={styles.inputCard}>
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Job cost</Text>
            <View style={styles.inputWrap}>
              <Text style={styles.inputPrefix}>$</Text>
              <TextInput
                style={styles.input}
                value={costStr}
                onChangeText={setCostStr}
                placeholder="0"
                placeholderTextColor={t.textMuted}
                keyboardType="numeric"
                inputMode="numeric"
                returnKeyType="done"
              />
            </View>
          </View>
          <View style={styles.inputDivider} />
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Your usual markup</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={markupStr}
                onChangeText={setMarkupStr}
                placeholder="18"
                placeholderTextColor={t.textMuted}
                keyboardType="numeric"
                inputMode="numeric"
                returnKeyType="done"
              />
              <Text style={styles.inputSuffix}>%</Text>
            </View>
          </View>
          <View style={styles.inputDivider} />
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Competing bids <Text style={styles.inputHint}>(optional)</Text></Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={competitorsStr}
                onChangeText={setCompetitorsStr}
                placeholder="—"
                placeholderTextColor={t.textMuted}
                keyboardType="numeric"
                inputMode="numeric"
                returnKeyType="done"
              />
            </View>
          </View>
          <View style={styles.inputDivider} />
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Client name</Text>
            <TextInput
              style={[styles.input, { minWidth: 140 }]}
              value={clientNameStr}
              onChangeText={setClientNameStr}
              placeholder={selectedLead?.name ?? 'Client'}
              placeholderTextColor={t.textMuted}
              returnKeyType="done"
            />
          </View>
        </View>

        {/* Lead picker — links the proposal so accept/decline trains the curve. */}
        {!leadId && pickableLeads.length > 0 && (
          <View style={styles.leadCard}>
            <Text style={styles.leadCardTitle}>Link a lead</Text>
            <Text style={styles.leadCardSub}>
              Accept/decline updates the lead to won/lost — that history trains your pricing curve.
            </Text>
            <View style={styles.leadChips}>
              {pickableLeads.map(l => {
                const active = l.id === selectedLeadId;
                return (
                  <TouchableOpacity
                    key={l.id}
                    style={[styles.leadChip, active && { borderColor: t.accent, backgroundColor: t.accent + '18' }]}
                    onPress={() => setSelectedLeadId(active ? null : l.id)}
                    activeOpacity={0.8}
                  >
                    <User size={12} color={active ? t.accent : t.textMuted} strokeWidth={1.75} />
                    <Text style={[styles.leadChipText, active && { color: t.accent }]} numberOfLines={1}>{l.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
        {selectedLead && leadId && (
          <Text style={styles.linkedLeadNote}>Linked lead: {selectedLead.name} — accept/decline will mark it won/lost.</Text>
        )}

        {!built ? (
          <View style={styles.infoCard}>
            <FileSignature size={26} color={t.accent} strokeWidth={1.7} />
            <Text style={styles.infoTitle}>Enter a job cost to build the proposal</Text>
            <Text style={styles.infoBody}>
              Smart Proposal turns your estimate into three client-ready options — Essential,
              Signature, Premium — each priced by the Win Optimizer to balance margin against
              the odds of closing. Share it, then mark the answer to sharpen the next one.
            </Text>
          </View>
        ) : (
          <>
            {/* Status */}
            <View style={styles.statusRow}>
              <View style={[styles.statusChip, { backgroundColor: statusColor + '22' }]}>
                <Text style={[styles.statusChipText, { color: statusColor }]}>{STATUS_LABEL[status]}</Text>
              </View>
              <Text style={styles.statusHint}>{clientName ? `For ${clientName}` : 'Tap a tier to select it'}</Text>
            </View>

            {/* Tier cards */}
            {built.tiers.map(tier => (
              <TierCard
                key={tier.key}
                tier={tier}
                selected={tier.key === selectedTierKey}
                onSelect={() => { setSelectedTierKey(tier.key); if (proposalId) updateProposal(proposalId, { selectedTierKey: tier.key }); }}
                t={t}
                styles={styles}
              />
            ))}

            {/* Actions */}
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: t.accent }]} onPress={handleShare} activeOpacity={0.85} testID="proposal-share">
              <Share2 size={18} color={t.bg} strokeWidth={1.75} />
              <Text style={[styles.primaryBtnText, { color: t.bg }]}>Share with client</Text>
            </TouchableOpacity>
            <View style={styles.outcomeRow}>
              <TouchableOpacity
                style={[styles.outcomeBtn, { borderColor: t.success }, status === 'accepted' && { backgroundColor: t.success + '22' }]}
                onPress={handleAccept}
                disabled={decided}
                activeOpacity={0.85}
                testID="proposal-accept"
              >
                <CheckCircle2 size={16} color={t.success} strokeWidth={1.75} />
                <Text style={[styles.outcomeBtnText, { color: t.success }]}>Mark accepted</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.outcomeBtn, { borderColor: t.danger }, status === 'declined' && { backgroundColor: t.danger + '22' }]}
                onPress={handleDecline}
                disabled={decided}
                activeOpacity={0.85}
                testID="proposal-decline"
              >
                <XCircle size={16} color={t.danger} strokeWidth={1.75} />
                <Text style={[styles.outcomeBtnText, { color: t.danger }]}>Mark declined</Text>
              </TouchableOpacity>
            </View>

            {/* GC-facing reasoning */}
            <Text style={styles.sectionTitle}>Why these prices</Text>
            <View style={styles.driversCard}>
              {built.drivers.map((d, i) => (
                <View key={i} style={[styles.driverRow, i > 0 && styles.driverBorder]}>
                  <View style={{ marginTop: 2 }}><MageAIMark size={14} color={t.accent} /></View>
                  <Text style={styles.driverText}>{d}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.note}>
              The shared version carries prices and inclusions only — win odds, expected profit,
              and markup never leave this screen. Marking the outcome trains the pricing curve
              ({built.sampleSize} closed proposal{built.sampleSize === 1 ? '' : 's'} so far).
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function TierCard({ tier, selected, onSelect, t, styles }: {
  tier: ProposalTier; selected: boolean; onSelect: () => void;
  t: ThemeColors; styles: ReturnType<typeof makeStyles>;
}) {
  const accent = tier.recommended ? t.accent : t.line;
  return (
    <TouchableOpacity
      style={[styles.tierCard, tier.recommended && { borderColor: accent, borderWidth: 1.5 }, selected && styles.tierCardSelected]}
      onPress={onSelect}
      activeOpacity={0.85}
      testID={`tier-${tier.key}`}
    >
      <View style={styles.tierHead}>
        <View style={styles.tierTitleRow}>
          {tier.recommended && <Star size={14} color={t.accent} fill={t.accent} strokeWidth={1.75} />}
          <Text style={styles.tierLabel}>{tier.label}</Text>
          {tier.recommended && (
            <View style={[styles.recChip, { backgroundColor: t.accent + '22' }]}>
              <Text style={[styles.recChipText, { color: t.accent }]}>Recommended</Text>
            </View>
          )}
        </View>
        <View style={styles.tierPriceRow}>
          <Text style={styles.tierPrice}>{formatMoney(tier.price)}</Text>
          {selected && <Check size={16} color={t.accent} strokeWidth={1.75} />}
        </View>
      </View>
      <Text style={styles.tierTagline}>{tier.tagline}</Text>
      <View style={styles.inclusions}>
        {tier.inclusions.map((inc, i) => (
          <View key={i} style={styles.inclusionRow}>
            <Check size={12} color={t.success} style={{ marginTop: 3 }} strokeWidth={1.75} />
            <Text style={styles.inclusionText}>{inc}</Text>
          </View>
        ))}
      </View>
      {/* GC-only strip — never appears in the shared/client output. */}
      <View style={styles.internalStrip}>
        <Lock size={11} color={t.textMuted} strokeWidth={1.75} />
        <Text style={styles.internalText}>
          Internal · {Math.round(tier.winProbability * 100)}% win odds · {formatMoney(tier.expectedProfit)} expected profit · {Math.round(tier.markup * 100)}% markup
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerBtn: { width: 38, height: 38, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerText: { flex: 1 },
  headerEyebrow: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, letterSpacing: 0.4 },
  headerTitle: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text },

  inputCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, paddingHorizontal: 16, marginBottom: 14,
  },
  inputRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingVertical: 14 },
  inputDivider: { height: 1, backgroundColor: t.line },
  inputLabel: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  inputHint: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '500' as const },
  inputWrap: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2, minWidth: 110, justifyContent: 'flex-end' as const },
  inputPrefix: { fontSize: Type.headline.fontSize, color: t.textSecondary, fontWeight: '700' as const },
  inputSuffix: { fontSize: Type.headline.fontSize, color: t.textSecondary, fontWeight: '700' as const },
  input: {
    fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text,
    textAlign: 'right' as const, minWidth: 60, padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },

  leadCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 14, marginBottom: 14, gap: 6,
  },
  leadCardTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  leadCardSub: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 16 },
  leadChips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 4 },
  leadChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.full,
    borderWidth: 1, borderColor: t.line, maxWidth: 180,
  },
  leadChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  linkedLeadNote: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginBottom: 14, lineHeight: 16 },

  statusRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 12 },
  statusChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.full },
  statusChipText: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const },
  statusHint: { fontSize: Type.caption1.fontSize, color: t.textMuted },

  tierCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 16, marginBottom: 12, gap: 8,
  },
  tierCardSelected: { backgroundColor: t.surfaceAlt },
  tierHead: { gap: 4 },
  tierTitleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  tierLabel: { fontSize: Type.headline.fontSize, fontWeight: '800' as const, color: t.text },
  recChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Tokens.radius.full },
  recChipText: { fontSize: Type.caption2.fontSize, fontWeight: '800' as const },
  tierPriceRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  tierPrice: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.5 },
  tierTagline: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  inclusions: { gap: 5, marginTop: 2 },
  inclusionRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 7 },
  inclusionText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 18 },
  internalStrip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5,
    marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.line,
  },
  internalText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const },

  primaryBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8, paddingVertical: 14, borderRadius: Tokens.radius.card, marginTop: 4, marginBottom: 10,
  },
  primaryBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const },
  outcomeRow: { flexDirection: 'row' as const, gap: 10, marginBottom: 18 },
  outcomeBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 6, paddingVertical: 12, borderRadius: Tokens.radius.card, borderWidth: 1.5,
  },
  outcomeBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const },

  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10, marginTop: 2 },

  driversCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, paddingHorizontal: 14, marginBottom: 16,
  },
  driverRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8, paddingVertical: 12 },
  driverBorder: { borderTopWidth: 1, borderTopColor: t.line },
  driverText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 19 },

  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginBottom: 14 },

  infoCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 24, alignItems: 'center' as const,
    gap: 10, marginTop: 8,
  },
  infoTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text, textAlign: 'center' as const },
  infoBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 20, textAlign: 'center' as const },
});
