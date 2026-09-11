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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Modal, KeyboardAvoidingView, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, Mic, X, Save, Trophy, AlertTriangle, CheckCircle2,
  Trash2, ChevronDown, ChevronUp, Briefcase, ArrowRight, FileDown, Scale,
  Mail, Copy,
} from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { MageAIMark } from '@/components/icons';
import { generateA401PDF, type A401Data } from '@/utils/aiaForms';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
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
import { reviewPrequalPacket } from '@/utils/prequalEngine';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useCostSeeds } from '@/hooks/useCostSeeds';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { cardSurface } from '@/components/ui';
import { showAlert } from '@/utils/alert';
import { useAuth } from '@/contexts/AuthContext';
import { copyToClipboard } from '@/utils/clipboard';
import { fetchBidInvites, sendBidInvites } from '@/utils/bidInvites';
import {
  bidInviteUrl, inviteCoverage, inviteState, inviteStateLabel, parseInviteEmails, splitAlreadyInvited,
  type BidInviteRecord,
} from '@/utils/bidInviteCore';

// Invite timestamps are instants (timestamptz), shown here as the day they
// fall on in the reader's own zone — which is what a GC means by "sent Tuesday".
function fmtInviteDay(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const STATUS_COLORS: Record<BidPackageStatus, string> = {
  open: '#FF6A1A',
  leveling: '#0D6CB1',
  awarded: '#16A34A',
  cancelled: '#9CA3AF',
};

export default function BuyoutPackageScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { packageId } = useLocalSearchParams<{ packageId: string }>();
  const {
    projects, commitments,
    getBidPackage, updateBidPackage, deleteBidPackage,
    getBidsForPackage, addBidPackageBid, updateBidPackageBid, deleteBidPackageBid,
    awardBidPackage, getProject, prequalPackets, getSubcontractor,
    updateCommitment, getCommitmentsForProject,
    settings,
  } = useProjects();
  const { tier: subscriptionTier } = useSubscription();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { receipts } = useMaterialReceipts();
  // Cold-start seeds — same reason as app/bid-leveling.tsx.
  const { seeds } = useCostSeeds();

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

  // ── Invitations to bid ───────────────────────────────────────
  // Until this existed, every bid in the matrix was one the GC typed himself:
  // bid_package_bids is owner-scoped, so a sub — who has no account — could
  // never write one. An invite is a random token on an owner-owned row that
  // buys exactly one insert through a SECURITY DEFINER RPC.
  const [invites, setInvites] = useState<BidInviteRecord[]>([]);
  const [invitesFailed, setInvitesFailed] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmails, setInviteEmails] = useState('');
  const [inviteSending, setInviteSending] = useState(false);

  const loadInvites = useCallback(async () => {
    if (!packageId) return;
    const rows = await fetchBidInvites(packageId);
    // A read that failed is not an empty list. Keep whatever we last had and
    // say so — "Nobody invited yet" over a dropped read sends the GC to invite
    // subs who are already holding a live link.
    if (rows === null) { setInvitesFailed(true); return; }
    setInvitesFailed(false);
    setInvites(rows);
  }, [packageId]);

  useEffect(() => { void loadInvites(); }, [loadInvites]);

  // A bid filed through an invite is written by the RPC, server-side. This
  // device's bid cache was populated before that row existed, so without a
  // refetch the GC sees "Bid received" against the invite and an empty matrix
  // next to it. Each bid id is pulled at most once — a refetch that doesn't
  // produce it (no session, no network) must not re-arm the effect.
  const pulledBidIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const known = new Set(bids.map(b => b.id));
    const missing = invites
      .map(inv => inv.bidId)
      .filter((id): id is string => !!id && !known.has(id) && !pulledBidIds.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) pulledBidIds.current.add(id);
    void queryClient.invalidateQueries({ queryKey: ['bid_package_bids'] });
  }, [invites, bids, queryClient]);

  // `inviteSending` drives the button's disabled prop, but state lands a frame
  // later — a double tap on "Send invitations" both get through and every sub
  // is minted TWO live tokens. `bid_invite_submit` blocks a second submit per
  // INVITE, not per bidder, so that sub can file two bids and the levelling
  // matrix shows one company as two competing bidders. This latch is a ref
  // because it has to be true on the second tap's synchronous read.
  const invitingRef = useRef(false);

  const handleSendInvites = useCallback(async () => {
    if (!pkg || !project) return;
    if (invitingRef.current) return;
    const uid = user?.id;
    if (!uid) {
      showAlert('Sign in first', 'An invite is filed against your account, so it needs a signed-in session. Sign in and try again.');
      return;
    }
    const { recipients, rejected } = parseInviteEmails(inviteEmails);
    if (recipients.length === 0) {
      showAlert(
        'No email addresses',
        rejected.length > 0
          ? `Couldn't read ${rejected.slice(0, 3).join(', ')} as an email address. One address per line, or separated by commas.`
          : "Type the subs' email addresses — one per line, or separated by commas.",
      );
      return;
    }
    // Anyone already holding a live link is skipped rather than given a second
    // token; expired and already-answered invites go through, because sending
    // those again is a deliberate re-invitation.
    const { fresh, alreadyLive } = splitAlreadyInvited(recipients, invites, Date.now());
    if (fresh.length === 0) {
      showAlert(
        'They already have a link',
        `${alreadyLive.slice(0, 3).join(', ')} ${alreadyLive.length === 1 ? 'is' : 'are'} already invited to this package and the link still works. Use the copy button next to their name to send it again — a second invite would let the same sub file two bids.`,
      );
      return;
    }
    invitingRef.current = true;
    setInviteSending(true);
    try {
      const results = await sendBidInvites(
        {
          userId: uid,
          packageId: pkg.id,
          projectId: pkg.projectId,
          packageName: pkg.name,
          projectName: project.name,
          csiDivision: pkg.csiDivision,
          phase: pkg.phase,
          scopeDescription: pkg.scopeDescription,
          replyToEmail: settings?.branding?.email,
        },
        fresh,
      );
      const synced = results.filter(r => r.outcome === 'synced');
      const queued = results.filter(r => r.outcome === 'queued');
      const failed = results.filter(r => r.outcome === 'failed');
      const mailed = synced.filter(r => r.emailed);

      // One recipient whose row is actually on the server: put the link where
      // the GC can text it. Subs answer a text far more often than an email.
      // A QUEUED row is deliberately excluded — that link resolves to
      // `bid_invite_denied` until the queue drains, and a sub who opens a dead
      // link reads it as "they withdrew it" and does not bid.
      let copied = false;
      if (synced.length === 1 && results.length === 1) {
        copied = await copyToClipboard(synced[0].url);
      }

      const lines: string[] = [];
      if (synced.length > 0) {
        lines.push(
          mailed.length === synced.length
            ? `${synced.length} invite${synced.length === 1 ? '' : 's'} sent. Each sub gets a link that shows the scope and takes their number — no account, no app, and nothing for you to re-key.`
            // Not "sent": the row is filed and the link is live, but the mail
            // hand-off did not happen, and telling him otherwise means he waits
            // on bids from subs who were never contacted.
            : `${synced.length} invite${synced.length === 1 ? '' : 's'} ready. The link shows the scope and takes their number — no account, no app, nothing for you to re-key.`,
        );
      }
      if (queued.length > 0) {
        lines.push(`${queued.length} invite${queued.length === 1 ? '' : 's'} saved on this phone only — you're offline. The link won't open until it uploads.`);
      }
      if (failed.length > 0) {
        lines.push(`${failed.length} couldn't be filed: ${failed.map(f => f.email).join(', ')}. Try again in a minute.`);
      }
      if (synced.length > 0 && mailed.length === 0) {
        lines.push('We could not hand the email off, so nothing has reached them yet — copy each link from the list below and text or email it over.');
      } else if (synced.length > mailed.length) {
        lines.push(`${synced.length - mailed.length} of those emails did not hand off — copy those links from the list below and send them yourself.`);
      }
      if (copied) lines.push('The link is on your clipboard.');
      if (alreadyLive.length > 0) {
        lines.push(`Skipped (already holding a live link): ${alreadyLive.slice(0, 3).join(', ')}.`);
      }
      if (rejected.length > 0) lines.push(`Skipped (not an email address): ${rejected.slice(0, 3).join(', ')}.`);

      setShowInvite(false);
      setInviteEmails('');
      await loadInvites();
      if (Platform.OS !== 'web' && failed.length === 0) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert(failed.length > 0 ? 'Some invites did not go' : 'Subs invited', lines.join('\n\n'));
    } catch (e) {
      // Nothing below sendBidInvites throws today, but a silent rejection here
      // would leave the sheet open with no spinner and no message — the GC taps
      // Send again and files a second token for every sub.
      console.warn('[buyout] invite send failed', e);
      showAlert('Invites did not go', 'Something went wrong sending those invitations. Check the list below before you try again — some may already be filed.');
      await loadInvites();
    } finally {
      invitingRef.current = false;
      setInviteSending(false);
    }
  }, [pkg, project, user, inviteEmails, settings, loadInvites, invites]);

  const handleCopyInviteLink = useCallback(async (invite: BidInviteRecord) => {
    const ok = await copyToClipboard(bidInviteUrl(invite.inviteToken));
    showAlert(
      ok ? 'Link copied' : 'Could not copy',
      ok
        ? `Text or email this to ${invite.subEmail}. It opens the scope for this package and takes their bid.`
        : 'Your browser blocked the clipboard. Long-press to select the link instead.',
    );
  }, []);

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
      showAlert('Missing info', 'Vendor name and amount are both required.');
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
      showAlert('Need 2+ bids', 'Add at least two bids before running AI leveling.');
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
      const result = await levelBids({ pkg, bids, projects, commitments, receipts, seeds });
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
        showAlert('AI leveling unavailable', 'The AI is offline right now. Try again in a minute, or compare bids manually.');
      } else {
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      showAlert('Leveling failed', String((err as Error)?.message || err));
    } finally {
      setLeveling(false);
    }
  }, [pkg, bids, projects, commitments, receipts, seeds, updateBidPackageBid, subscriptionTier]);

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

    // D4-1: structured blocker evaluation via prequalEngine
    const review = packet ? reviewPrequalPacket(packet) : null;
    const blockers: string[] = [];
    if (!packet) {
      blockers.push(sub ? 'No prequal packet on file for this sub.' : 'Bid is not linked to a tracked subcontractor — no prequal/COI verified.');
    } else if (review && review.overall !== 'pass') {
      for (const f of review.findings) {
        if (!f.passed && f.severity === 'blocker') blockers.push(f.note ? `${f.label} — ${f.note}` : f.label);
      }
      if (blockers.length === 0) blockers.push(`Prequal not approved: ${review.summary}`);
    }
    const isRisky = blockers.length > 0;

    const lines: string[] = [];
    lines.push(`Vendor: ${bid.vendorName ?? sub?.companyName ?? 'Subcontractor'}`);
    lines.push(`Leveled total: ${formatMoney(total)}`);
    lines.push(`Buyout ${savings >= 0 ? 'savings' : 'overrun'}: ${formatMoney(Math.abs(savings))}`);
    if (allowanceItems.length > 0) {
      lines.push('');
      lines.push(`- ${allowanceItems.length} allowance item${allowanceItems.length === 1 ? '' : 's'} will lock to firm price.`);
    }
    if (isRisky) {
      lines.push('');
      lines.push(`Note: Prequal: ${blockers[0]}`);
    }
    lines.push('');
    lines.push('Awarding will create a Commitment and mark this package complete.');

    const doAward = () => {
      const commitmentId = awardBidPackage(pkg.id, bid.id);
      if (commitmentId) {
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // D4-1: record override audit line on the commitment when risks were acknowledged
        if (isRisky) {
          try {
            const overrideLine = `[risk-override ${new Date().toISOString().slice(0, 10)}] Awarded despite: ${blockers.join('; ')}. Acknowledged by GC.`;
            const existing = getCommitmentsForProject(pkg.projectId).find(c => c.id === commitmentId);
            const existingNotes = existing?.notes ?? '';
            updateCommitment(commitmentId, {
              notes: (existingNotes ? existingNotes + '\n' : '') + overrideLine,
            });
          } catch (e) {
            console.warn('[award-override] Failed to record override note on commitment:', e);
          }
        }
      }
    };

    if (!isRisky) {
      showAlert(
        'Award this bid?',
        lines.join('\n'),
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Award', style: 'default', onPress: doAward },
        ],
      );
    } else {
      showAlert(
        'Compliance risk — review before award',
        [
          ...lines,
          '',
          'RISKS:',
          ...blockers.map(b => '• ' + b),
          '',
          'Awarding accepts this compliance/insurance exposure. Your override will be recorded on the commitment.',
        ].join('\n'),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Review override',
            style: 'destructive',
            onPress: () => showAlert(
              'Confirm risk override',
              `Award ${bid.vendorName ?? sub?.companyName ?? 'this sub'} despite:\n\n${blockers.map(b => '• ' + b).join('\n')}\n\nThis is the GC's compliance risk and will be recorded.`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Award & accept risk', style: 'destructive', onPress: doAward },
              ],
            ),
          },
        ],
      );
    }
  }, [pkg, awardBidPackage, getSubcontractor, prequalPackets, allowanceItems, updateCommitment, getCommitmentsForProject]);

  // Generate A401-styled subcontract PDF for the awarded sub. Pulls
  // scope, contract sum, and CSI division from the bid package; pulls
  // sub info from the awarded bid; pulls GC info from settings.branding.
  // The GC fills in any missing pieces (start date, retainage % override,
  // insurance reqs) by editing the form on the GC's letterhead.
  const handleGenerateSubcontract = useCallback(async () => {
    if (!pkg || !pkg.awardedBidId || !project) return;
    const winningBid = bids.find(b => b.id === pkg.awardedBidId);
    if (!winningBid) {
      showAlert('No awarded bid', 'Award a bid before generating the subcontract.');
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
      showAlert('Could not generate subcontract', err instanceof Error ? err.message : 'Try again.');
    }
  }, [pkg, bids, project, settings]);

  const handleDeletePackage = useCallback(() => {
    if (!pkg) return;
    showAlert(
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

  // Invites outstanding change what "too few bids" means: two bids with three
  // subs still holding a live link is a waiting problem, not a coverage one.
  const coverage = inviteCoverage(invites, Date.now());

  // Which rows in the matrix the sub typed himself. Read from the invite that
  // produced the bid rather than from bid.source, so a later edit to the bid
  // can't quietly turn a sub's own number into one the GC appears to have
  // keyed — which is the difference between a quote and a recollection.
  const invitedBidIds = new Set(
    invites.map(inv => inv.bidId).filter((id): id is string => !!id),
  );

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
        <ScrollView {...fabScroll} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
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
                  <Text style={[styles.heroBudgetValue, { color: pkg.buyoutSavings >= 0 ? themeColors.success : themeColors.danger }]}>
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
                  <AlertTriangle size={14} color="#0D6CB1" strokeWidth={1.75} />
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
                  <AlertTriangle size={14} color={Colors.warningLabel} strokeWidth={1.75} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.warningTitle}>Coverage risk · {bids.length} bid{bids.length === 1 ? '' : 's'} in</Text>
                    <Text style={styles.warningBody}>
                      Industry best practice is 3+ qualified bids per package.
                      {coverage.awaiting > 0
                        ? ` ${coverage.awaiting} invited sub${coverage.awaiting === 1 ? ' hasn’t' : 's haven’t'} answered yet — chase them, or invite more.`
                        : ' Invite more subs before awarding.'}
                    </Text>
                    <TouchableOpacity
                      style={styles.warningActionBtn}
                      onPress={() => setShowInvite(true)}
                      activeOpacity={0.85}
                      testID="coverage-invite-subs"
                    >
                      <Mail size={13} color={Colors.warningLabel} strokeWidth={1.75} />
                      <Text style={styles.warningActionText}>Invite subs to bid</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              {stale && (
                <View style={styles.warningCard}>
                  <AlertTriangle size={14} color={Colors.warningLabel} strokeWidth={1.75} />
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
                    <MageAIMark size={16} color="#FFF" />
                    <Text style={styles.levelBtnText}>{levelingResult ? 'Re-run AI leveling' : 'Run AI leveling'}</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.levelLinkBtn}
                onPress={() => router.push({ pathname: '/bid-leveling', params: { packageId: pkg.id } })}
                activeOpacity={0.85}
              >
                <Scale size={15} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.levelLinkBtnText}>Open leveling board</Text>
                <ArrowRight size={14} color={themeColors.accent} strokeWidth={1.75} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.levelLinkBtn}
                onPress={() => router.push({ pathname: '/judges', params: { projectId: pkg.projectId } } as never)}
                activeOpacity={0.85}
              >
                <Briefcase size={15} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.levelLinkBtnText}>Score with Bid Advisor</Text>
                <ArrowRight size={14} color={themeColors.accent} strokeWidth={1.75} />
              </TouchableOpacity>
              {!!levelingResult?.summary && (
                <View style={styles.levelingSummary}>
                  <View style={styles.levelingSummaryHead}>
                    <MageAIMark size={14} color={themeColors.accent} />
                    <Text style={styles.levelingSummaryHeadText}>AI leveling summary</Text>
                  </View>
                  <Text style={styles.levelingSummaryBody}>{levelingResult.summary}</Text>
                  {!!levelingResult.recommendedWinnerReason && (
                    <View style={styles.recommendation}>
                      <Trophy size={14} color={themeColors.success} strokeWidth={1.75} />
                      <Text style={styles.recommendationText}>{levelingResult.recommendedWinnerReason}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Invitations out. This is what makes "send the RFQ to more subs"
              an action rather than a scolding: the sub opens a link, sees the
              scope, and types a number that lands in the matrix below. */}
          {pkg.status !== 'awarded' && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Invited to bid</Text>
                <Text style={styles.sectionSub}>
                  {invitesFailed && invites.length === 0
                    ? 'Not loaded'
                    : coverage.invited === 0 ? 'Nobody invited yet' : `${coverage.responded} of ${coverage.invited} responded`}
                </Text>
              </View>

              {invitesFailed && (
                <View style={[styles.warningCard, { marginBottom: 8 }]}>
                  <AlertTriangle size={14} color={Colors.warningLabel} strokeWidth={1.75} />
                  <Text style={[styles.warningBody, { flex: 1, marginTop: 0 }]}>
                    Couldn&apos;t reach the server to check your invitations, so this list may be out of date — it is not a claim that nobody was invited.
                  </Text>
                </View>
              )}

              {invites.length === 0 ? (
                !invitesFailed && (
                  <View style={styles.emptyBids}>
                    <Text style={styles.emptyBidsText}>
                      Email the subs a link. They see this package&apos;s scope — not your budget — and type their number straight into the matrix below. No account, no app, nothing for you to re-key.
                    </Text>
                  </View>
                )
              ) : (
                invites.map(inv => {
                  const state = inviteState(inv, Date.now());
                  // Only hex tokens get an alpha suffix here — `textMuted` and
                  // `line` are rgba() in both themes, and concatenating '1A'
                  // onto those produces an invalid color, so the lapsed pill
                  // uses flat surface tokens instead of a tint.
                  const tone = state === 'responded' ? themeColors.success : Colors.warningLabel;
                  const pillStyle = state === 'expired'
                    ? { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.line }
                    : { backgroundColor: tone + '1A', borderColor: tone + '55' };
                  const pillInk = state === 'expired' ? themeColors.textMuted : tone;
                  const sentDay = fmtInviteDay(inv.createdAt);
                  const expiryDay = fmtInviteDay(inv.expiresAt);
                  return (
                    <View key={inv.id} style={styles.inviteCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.inviteWho} numberOfLines={1}>{inv.subName || inv.subEmail}</Text>
                        <Text style={styles.inviteMeta} numberOfLines={1}>
                          {sentDay ? `Sent ${sentDay}` : 'Sent'}
                          {state === 'awaiting' && expiryDay ? ` · link good through ${expiryDay}` : ''}
                          {state === 'responded' ? ' · their number is in the matrix below' : ''}
                        </Text>
                      </View>
                      <View style={[styles.invitePill, pillStyle]}>
                        <Text style={[styles.invitePillText, { color: pillInk }]}>{inviteStateLabel(state)}</Text>
                      </View>
                      {state !== 'responded' && (
                        <TouchableOpacity
                          onPress={() => { void handleCopyInviteLink(inv); }}
                          hitSlop={10}
                          style={styles.inviteCopyBtn}
                          accessibilityRole="button"
                          accessibilityLabel={`Copy the bid link for ${inv.subEmail}`}
                        >
                          <Copy size={15} color={themeColors.accent} strokeWidth={1.75} />
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })
              )}

              <TouchableOpacity
                style={styles.inviteBtn}
                onPress={() => setShowInvite(true)}
                activeOpacity={0.85}
                testID="invite-subs-to-bid"
              >
                <Mail size={15} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.inviteBtnText}>{invites.length === 0 ? 'Invite subs to bid' : 'Invite more subs'}</Text>
                <ArrowRight size={14} color={themeColors.accent} strokeWidth={1.75} />
              </TouchableOpacity>
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
                              <Trophy size={10} color="#FFF" strokeWidth={1.75} />
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
                              <CheckCircle2 size={10} color="#FFF" strokeWidth={1.75} />
                              <Text style={styles.awardedBadgeText}>AWARDED</Text>
                            </View>
                          )}
                          {invitedBidIds.has(bid.id) && (
                            <View style={styles.invitedBadge}>
                              <Text style={styles.invitedBadgeText}>SUB-ENTERED</Text>
                            </View>
                          )}
                          {outlier && (
                            <View style={styles.outlierBadge}>
                              <AlertTriangle size={10} color="#FFF" strokeWidth={1.75} />
                              <Text style={styles.outlierBadgeText}>
                                {outlier.kind === 'low' ? `${outlier.pct.toFixed(0)}% LOW` : `${outlier.pct.toFixed(0)}% HIGH`}
                              </Text>
                            </View>
                          )}
                        </View>
                        {outlier && (
                          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
                            <AlertTriangle size={Type.caption2.fontSize} color={Colors.warningLabel} strokeWidth={2} style={{ marginTop: 1 }} />
                            <Text style={[styles.outlierHint, { flex: 1 }]}>
                              {outlier.kind === 'low'
                                ? 'Significantly below the median — review for missing scope before awarding.'
                                : 'Significantly above the median — sub may have priced in protection or unfamiliarity.'}
                            </Text>
                          </View>
                        )}
                        {!!bid.terms && <Text style={styles.bidTerms} numberOfLines={1}>{bid.terms}</Text>}
                      </View>
                      <TouchableOpacity onPress={() => deleteBidPackageBid(bid.id)} hitSlop={10} style={styles.bidDelete} accessibilityRole="button" accessibilityLabel="Delete">
                        <Trash2 size={14} color={themeColors.textMuted} strokeWidth={1.75} />
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
                          <Text style={[styles.bidAmountValue, { color: bid.normalizedAdjustment > 0 ? Colors.warning : themeColors.success }]}>
                            {bid.normalizedAdjustment > 0 ? '+' : ''}{formatMoney(bid.normalizedAdjustment)}
                          </Text>
                        </View>
                      )}
                      <View style={styles.bidAmountCell}>
                        <Text style={[styles.bidAmountLabel, { color: themeColors.text, fontWeight: '700' }]}>Leveled total</Text>
                        <Text style={[styles.bidAmountValueTotal, { color: vsBudget >= 0 ? themeColors.success : themeColors.danger }]}>
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
                      <View style={[styles.bidScopeBlock, { backgroundColor: themeColors.danger + '0F', borderLeftColor: themeColors.danger }]}>
                        <Text style={[styles.bidScopeLabel, { color: themeColors.danger }]}>Excludes</Text>
                        <Text style={styles.bidScopeText}>{bid.excludes}</Text>
                      </View>
                    )}
                    {!!bid.normalizedAdjustmentReason && (
                      <View style={styles.adjReason}>
                        <MageAIMark size={11} color={themeColors.accent} />
                        <Text style={styles.adjReasonText}>{bid.normalizedAdjustmentReason}</Text>
                      </View>
                    )}

                    {pkg.status !== 'awarded' && (
                      <TouchableOpacity style={styles.awardBtn} onPress={() => handleAward(bid)} activeOpacity={0.85}>
                        <Trophy size={14} color="#FFF" strokeWidth={1.75} />
                        <Text style={styles.awardBtnText}>Award · {formatMoney(total)}</Text>
                        <ArrowRight size={14} color="#FFF" strokeWidth={1.75} />
                      </TouchableOpacity>
                    )}
                    {!!bid.subcontractorId && (
                      <TouchableOpacity
                        style={styles.subScorecardBtn}
                        onPress={() => router.push({ pathname: '/sub-scorecard', params: { subId: bid.subcontractorId } } as never)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.subScorecardBtnText}>See this sub's scorecard →</Text>
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
                <Briefcase size={16} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.openCommitmentText}>Open project · view this commitment</Text>
                <ChevronUp size={16} color={themeColors.accent} style={{ transform: [{ rotate: '90deg' }] }} strokeWidth={1.75} />
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
                <FileDown size={16} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.openCommitmentText}>Generate A401-style subcontract PDF</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Delete package */}
          <View style={styles.section}>
            <TouchableOpacity onPress={handleDeletePackage} style={styles.deletePkgBtn} activeOpacity={0.7}>
              <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
              <Text style={styles.deletePkgText}>Delete this package</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Add-bid FAB row */}
        {pkg.status !== 'awarded' && (
          <View style={[styles.fabRow, { bottom: insets.bottom + 18 }]}>
            <TouchableOpacity style={styles.fabSecondary} onPress={() => setShowAddBid(true)} activeOpacity={0.85}>
              <Plus size={16} color={themeColors.text} strokeWidth={1.75} />
              <Text style={styles.fabSecondaryText}>Add by hand</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.fabPrimary} onPress={() => setVoiceOpen(true)} activeOpacity={0.85}>
              <Mic size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.fabPrimaryText}>Add bid by voice</Text>
              <MageAIMark size={12} color="#FFF" />
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
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: themeColors.bg }}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Log a bid</Text>
              <TouchableOpacity onPress={() => setShowAddBid(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <X size={22} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text style={styles.fieldLabel}>Vendor *</Text>
              <TextInput style={styles.input} value={newVendor} onChangeText={setNewVendor} placeholder="e.g. Joe's Plumbing" placeholderTextColor={themeColors.textMuted} autoFocus />
              <Text style={styles.fieldLabel}>Amount *</Text>
              <TextInput style={styles.input} value={newAmount} onChangeText={setNewAmount} placeholder="Total dollar bid" placeholderTextColor={themeColors.textMuted} keyboardType="numeric" />
              <Text style={styles.fieldLabel}>Includes</Text>
              <TextInput style={[styles.input, styles.multilineInput]} value={newIncludes} onChangeText={setNewIncludes} placeholder="What's covered (drives leveling)" placeholderTextColor={themeColors.textMuted} multiline />
              <Text style={styles.fieldLabel}>Excludes</Text>
              <TextInput style={[styles.input, styles.multilineInput]} value={newExcludes} onChangeText={setNewExcludes} placeholder="What's NOT covered (the gotcha)" placeholderTextColor={themeColors.textMuted} multiline />
              <Text style={styles.fieldLabel}>Terms</Text>
              <TextInput style={styles.input} value={newTerms} onChangeText={setNewTerms} placeholder="Net 30, 10% deposit, etc." placeholderTextColor={themeColors.textMuted} />
            </ScrollView>
            <View style={[styles.modalFoot, { paddingBottom: insets.bottom + 12 }]}>
              <TouchableOpacity style={styles.saveBtn} onPress={handleAddBid} activeOpacity={0.85}>
                <Save size={16} color="#FFF" strokeWidth={1.75} />
                <Text style={styles.saveBtnText}>Save bid</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Invite-subs modal */}
        <Modal visible={showInvite} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowInvite(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: themeColors.bg }}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Invite subs to bid</Text>
              <TouchableOpacity onPress={() => setShowInvite(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <X size={22} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text style={styles.inviteExplain}>
                Each sub gets their own link to <Text style={{ fontWeight: '700' }}>{pkg.name}</Text>. It shows the scope, the CSI division and the phase — never your estimate budget — and takes their amount, inclusions and exclusions straight into the leveling matrix.
              </Text>
              <Text style={styles.fieldLabel}>Sub email addresses *</Text>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={inviteEmails}
                onChangeText={setInviteEmails}
                placeholder={'joe@acemech.com\nmaria@bpl-electric.com'}
                placeholderTextColor={themeColors.textMuted}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                testID="invite-emails-input"
              />
              <Text style={styles.inviteHint}>One per line, or separated by commas — a pasted &quot;Joe Smith &lt;joe@ace.com&gt;&quot; works too. Each link lands in the list on this screen as well, so if the email can&apos;t go out you can copy it and text it over. Links stop working after 30 days — the same window material pricing holds for.</Text>
            </ScrollView>
            <View style={[styles.modalFoot, { paddingBottom: insets.bottom + 12 }]}>
              <TouchableOpacity
                style={[styles.saveBtn, inviteSending && { opacity: 0.6 }]}
                onPress={() => { void handleSendInvites(); }}
                disabled={inviteSending}
                activeOpacity={0.85}
                testID="invite-send"
              >
                {inviteSending ? (
                  <>
                    <ActivityIndicator size="small" color="#FFF" />
                    <Text style={styles.saveBtnText}>Sending…</Text>
                  </>
                ) : (
                  <>
                    <Mail size={16} color="#FFF" strokeWidth={1.75} />
                    <Text style={styles.saveBtnText}>Send invitations</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    </>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: Type.subhead.fontSize, color: t.textMuted },

  hero: {
    margin: 16,
    padding: 18,
    borderRadius: Tokens.radius.xl,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.line,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusPillText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, letterSpacing: 0.3, textTransform: 'uppercase' },
  heroPhase: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' as const },
  heroName: { fontSize: 24, fontWeight: '800' as const, color: t.text, letterSpacing: -0.5, marginBottom: 14 },
  heroBudgetRow: { flexDirection: 'row', gap: 16 },
  heroBudgetCell: { flex: 1 },
  heroBudgetLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 },
  heroBudgetValue: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text },

  section: { paddingHorizontal: 16, paddingBottom: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, marginTop: 4 },
  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, letterSpacing: -0.3 },
  sectionSub: { fontSize: Type.caption1.fontSize, color: t.textMuted },

  levelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: t.text,
    paddingVertical: 14,
    borderRadius: Tokens.radius.lg,
  },
  levelBtnText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const },
  levelLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 8,
    paddingVertical: 11,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: t.accent + '40',
    backgroundColor: t.accent + '0F',
  },
  levelLinkBtnText: { color: t.accent, fontSize: Type.subhead.fontSize, fontWeight: '700' as const },
  levelingSummary: {
    marginTop: 12,
    backgroundColor: t.accent + '0F',
    borderLeftWidth: 4,
    borderLeftColor: t.accent,
    borderRadius: Tokens.radius.card,
    padding: 14,
    gap: 6,
  },
  levelingSummaryHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  levelingSummaryHeadText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.accent, textTransform: 'uppercase', letterSpacing: 0.5 },
  levelingSummaryBody: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 19 },
  recommendation: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, padding: 8, backgroundColor: t.success + '15', borderRadius: Tokens.radius.sm },
  recommendationText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text, lineHeight: 17, fontWeight: '600' as const },

  emptyBids: { backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 22, borderWidth: 1, borderColor: t.line },
  emptyBidsText: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 19 },

  bidCard: { backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 14, borderWidth: 1, borderColor: t.line, marginBottom: 10, gap: 10 },
  bidCardWinner: { borderColor: t.success, borderWidth: 2, backgroundColor: t.success + '08' },
  bidCardAwarded: { borderColor: t.success, borderWidth: 2 },
  bidCardOutlier: { borderColor: Colors.warning + '80', borderWidth: 1.5 },
  outlierBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.warning, paddingHorizontal: 6, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  outlierBadgeText: { fontSize: 9, fontWeight: '800' as const, color: '#FFF', letterSpacing: 0.5 },
  outlierHint: { fontSize: Type.caption2.fontSize, color: Colors.warningLabel, marginTop: 4, lineHeight: 15, fontWeight: '600' as const },
  warningCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: Colors.warning + '12', borderLeftWidth: 4, borderLeftColor: Colors.warning, padding: 12, borderRadius: Tokens.radius.md, marginBottom: 8 },
  warningTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  warningBody: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2, lineHeight: 17 },
  warningActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: Tokens.radius.sm, borderWidth: 1, borderColor: Colors.warningLabel + '55', backgroundColor: Colors.warning + '14' },
  warningActionText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: Colors.warningLabel },

  invitedBadge: { backgroundColor: t.success + '1F', paddingHorizontal: 6, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  invitedBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '800' as const, color: t.success, letterSpacing: 0.4 },

  inviteCard: { ...cardSurface(t, { radius: 'lg', pad: 'none' }), flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8 },
  inviteWho: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  inviteMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2 },
  invitePill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.full, borderWidth: 1 },
  invitePillText: { fontSize: Type.caption2.fontSize, fontWeight: '800' as const, letterSpacing: 0.4, textTransform: 'uppercase' },
  inviteCopyBtn: { padding: 4 },
  inviteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    marginTop: 4, paddingVertical: 12, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.accent + '40', backgroundColor: t.accent + '0F',
  },
  inviteBtnText: { color: t.accent, fontSize: Type.subhead.fontSize, fontWeight: '700' as const },
  inviteExplain: { fontSize: Type.footnote.fontSize, color: t.textMuted, lineHeight: 20 },
  inviteHint: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 8, lineHeight: 17 },
  bidHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bidNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  bidVendor: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: t.text },
  bidTerms: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
  bidDelete: { padding: 4 },
  winnerBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: t.success, paddingHorizontal: 6, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  winnerBadgeText: { fontSize: 9, fontWeight: '800' as const, color: '#FFF', letterSpacing: 0.5 },
  lowestBadge: { backgroundColor: t.accent + '22', paddingHorizontal: 6, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  lowestBadgeText: { fontSize: 9, fontWeight: '800' as const, color: t.accent, letterSpacing: 0.5 },
  awardedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: t.success, paddingHorizontal: 6, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  awardedBadgeText: { fontSize: 9, fontWeight: '800' as const, color: '#FFF', letterSpacing: 0.5 },

  bidAmountsRow: { flexDirection: 'row', gap: 14, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.line },
  bidAmountCell: { flex: 1 },
  bidAmountLabel: { fontSize: 10, fontWeight: '700' as const, color: t.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 },
  bidAmountValue: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: t.text },
  bidAmountValueTotal: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const },

  bidScopeBlock: { backgroundColor: t.surfaceAlt, borderLeftWidth: 4, borderLeftColor: t.success, borderRadius: Tokens.radius.sm, padding: 10, gap: 4 },
  bidScopeLabel: { fontSize: 10, fontWeight: '700' as const, color: t.success, letterSpacing: 0.5, textTransform: 'uppercase' },
  bidScopeText: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 18 },

  adjReason: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: 10, backgroundColor: t.accent + '08', borderRadius: Tokens.radius.sm },
  adjReasonText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text, lineHeight: 17, fontStyle: 'italic' },

  awardBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.success, paddingVertical: 12, borderRadius: Tokens.radius.card },
  awardBtnText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const },

  subScorecardBtn: { alignItems: 'center', paddingTop: 6 },
  subScorecardBtnText: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '600' as const },

  openCommitmentBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.accent + '15', paddingVertical: 14, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.accent + '40' },
  openCommitmentText: { color: t.accent, fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const },

  deletePkgBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  deletePkgText: { fontSize: Type.footnote.fontSize, color: t.danger, fontWeight: '600' as const },

  fabRow: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', gap: 8 },
  fabSecondary: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface, paddingHorizontal: 14, paddingVertical: 14, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line },
  fabSecondaryText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text },
  fabPrimary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.accentFill, paddingVertical: 14, borderRadius: Tokens.radius.lg, shadowColor: t.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  fabPrimaryText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const },

  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textMuted, marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: t.surface, paddingHorizontal: 14, paddingVertical: 12, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line, fontSize: Type.subhead.fontSize, color: t.text },
  multilineInput: { minHeight: 70 },
  modalFoot: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.accentFill, paddingVertical: 14, borderRadius: Tokens.radius.card },
  saveBtnText: { color: '#FFF', fontSize: Type.subhead.fontSize, fontWeight: '700' as const },
});
