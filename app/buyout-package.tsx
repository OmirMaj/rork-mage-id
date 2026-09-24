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
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, Mic, X, Save, Trophy, AlertTriangle, CheckCircle2,
  Trash2, ChevronDown, ChevronUp, Briefcase, ArrowRight, FileDown, Scale,
  Mail, Copy, FileText, Users, Link2, Clock, Send, Pencil,
} from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { MageAIMark } from '@/components/icons';
import { formatCalendarDay } from '@/utils/calendarDate';
import { generateA401PDF, type A401Data } from '@/utils/aiaForms';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import {
  BID_PACKAGE_STATUS_LABELS, type BidPackage, type BidPackageBid, type BidPackageStatus, type Subcontractor,
} from '@/types';
import { formatMoney } from '@/utils/formatters';
import VoiceCaptureModal from '@/components/VoiceCaptureModal';
import { parseBidFromTranscript } from '@/utils/voiceFormParsers';
import { levelBids, type LevelingResult } from '@/utils/bidLevelingEngine';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import { reviewPrequalPacket } from '@/utils/prequalEngine';
import { prequalAwardLeg } from '@/utils/prequalAwardGate';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useCostSeeds } from '@/hooks/useCostSeeds';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { cardSurface } from '@/components/ui';
import { showAlert } from '@/utils/alert';
import { useAuth } from '@/contexts/AuthContext';
import { copyToClipboard } from '@/utils/clipboard';
import {
  deliverPendingBidInvites, fetchBidInvites, loadPendingBidInvites, remindBidInvites, sendBidInvites,
} from '@/utils/bidInvites';
import {
  NOT_EMAILED_ROW, mergeInvitesWithPending, notEmailedSentence, type PendingBidInvite,
} from '@/utils/bidInvitePending';
import { onQueueFlushed } from '@/utils/offlineQueue';
import { pdfFailureMessage } from '@/utils/platformFile';
import { resolveRetainagePercent } from '@/utils/retainageSource';
import {
  bidAmountOf, compareBidsForMatrix, isSellBasisBudget, packageCostBudget, parseBidAmountInput,
} from '@/utils/bulkSavings';
import {
  attachRosterIds, bidDueLabel, bidDueState, bidInviteUrl, inviteCoverage, inviteState, inviteStateLabel,
  parseInviteEmails, remindableInvites, resolveBidSubcontractor, splitAlreadyInvited,
  type BidInviteRecord, type InviteRecipient,
} from '@/utils/bidInviteCore';
import { canGenerateScope, estimateItemsToScope } from '@/utils/estimateItemsToScope';
import { complianceLabel, getComplianceStatus, reviewAwardCompliance } from '@/utils/subCompliance';
import { subCoiExpiryAcross } from '@/utils/projectContextPure';
import { matchSubForPhase } from '@/utils/subTradeMatch';
import { normalizeTradeKey } from '@/utils/laborSamples';
import { leveledBidTotal, leveledBuyoutSavings, packageBuyoutSavings, uncoveredScopeOf, openExcludedScope, awardedCommitmentOf } from '@/utils/projectFinancials';

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
    awardBidPackage, getProject, prequalPackets, getSubcontractor, subcontractors,
    getCOIsForSub, getInvoicesForProject, getAIAPayAppsForProject,
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
  // Leveled savings off the awarded bid — the same figure the Award dialog
  // showed — and the excluded scope he still has to place (audit round 2, #5).
  const heroSavings = pkg ? packageBuyoutSavings(pkg, bids, commitments) : null;
  // Minus what an edited-up commitment already absorbed (openExcludedScope).
  // A budget stored at SELL by the old auto-fill (#11): savings against it
  // are his own markup, so every savings figure on this screen is withheld
  // and the budget is flagged for review, with a one-tap fix to its cost.
  const sellBasis = useMemo(
    () => (pkg ? isSellBasisBudget(pkg, project?.linkedEstimate?.items) : false),
    [pkg, project],
  );
  const costBudget = useMemo(
    () => (pkg ? packageCostBudget(pkg, project?.linkedEstimate?.items) : null),
    [pkg, project],
  );
  const heroUncovered = pkg?.status === 'awarded'
    ? openExcludedScope(bids.find(b => b.id === pkg.awardedBidId), awardedCommitmentOf(pkg, commitments)?.amount)
    : 0;

  // Identify allowance items that the package will lock to firm price
  // when awarded. This drives the "contains allowances" banner so the
  // GC understands the buyout's downstream effect on the estimate.
  const allowanceItems = useMemo(() => {
    if (!pkg || !project?.linkedEstimate) return [];
    return project.linkedEstimate.items.filter(
      i => pkg.linkedEstimateItemIds.includes(i.materialId) && i.isAllowance,
    );
  }, [pkg, project]);

  // Every estimate line this package covers — the source the scope of work is
  // written from, and the reason the scope needs no AI call.
  const packageItems = useMemo(() => {
    if (!pkg || !project?.linkedEstimate) return [];
    return project.linkedEstimate.items.filter(i => pkg.linkedEstimateItemIds.includes(i.materialId));
  }, [pkg, project]);

  // ── Scope of work ────────────────────────────────────────────
  // `scopeDescription` is the ONLY description of the work the bidder ever
  // sees: the invite email prints it and `bid_invite_get` hands it to the
  // sub-facing page. It had no writer for any package made by hand, so subs
  // were asked to price a package NAME at an address — and the page's own
  // fallback copy then tells them to email the contractor for the scope, which
  // is the phone call this whole flow exists to replace.
  const scopeText = (pkg?.scopeDescription ?? '').trim();
  const [showScopeEdit, setShowScopeEdit] = useState(false);
  const [scopeDraft, setScopeDraft] = useState('');

  const [voiceOpen, setVoiceOpen] = useState(false);
  const [showAddBid, setShowAddBid] = useState(false);
  const [newVendor, setNewVendor] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newIncludes, setNewIncludes] = useState('');
  const [newExcludes, setNewExcludes] = useState('');
  const [newTerms, setNewTerms] = useState('');
  // Why the Add-bid sheet opened itself (#95): a voice bid with no dollar
  // amount lands here to be finished instead of being saved at $0.
  const [addBidNote, setAddBidNote] = useState<string | null>(null);
  // The bid whose amount is being fixed on its card (#95), and the draft.
  const [amountEditBidId, setAmountEditBidId] = useState<string | null>(null);
  const [amountDraft, setAmountDraft] = useState('');

  const [leveling, setLeveling] = useState(false);
  const [levelingResult, setLevelingResult] = useState<LevelingResult | null>(null);

  // ── Invitations to bid ───────────────────────────────────────
  // Until this existed, every bid in the matrix was one the GC typed himself:
  // bid_package_bids is owner-scoped, so a sub — who has no account — could
  // never write one. An invite is a random token on an owner-owned row that
  // buys exactly one insert through a SECURITY DEFINER RPC.
  // What the server last returned, and the invites filed on this phone that
  // have not uploaded (or not been emailed) yet (#14). The list is the merge:
  // a pending invite shows as "On this phone" and counts for
  // splitAlreadyInvited, so a second offline send cannot mint a second token.
  const [serverInvites, setServerInvites] = useState<BidInviteRecord[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingBidInvite[]>([]);
  const [invitesFailed, setInvitesFailed] = useState(false);
  // Why an invite's email did not go this session (#94), keyed by invite id —
  // "unsubscribed" and "could not hand off" need different next steps.
  const [notEmailed, setNotEmailed] = useState<Record<string, string>>({});
  // One line after offline invites were emailed on upload.
  const [deliveredNote, setDeliveredNote] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmails, setInviteEmails] = useState('');
  const [inviteSending, setInviteSending] = useState(false);
  // Subs picked off the roster in the invite sheet. The sheet used to be one
  // free-text box, so the GC typed addresses from memory for subs the app
  // already had on file — and the invite row, the bid the RPC copies it onto
  // and the commitment the award copies it onto again all ended up naming a
  // company and referencing no record.
  const [pickedSubIds, setPickedSubIds] = useState<string[]>([]);
  const [reminding, setReminding] = useState(false);
  // Session-scoped: `bid_package_invites` has no reminded_at column, so this
  // says "just now" for as long as the screen is open and never pretends to
  // remember it tomorrow.
  const [remindedIds, setRemindedIds] = useState<string[]>([]);
  // Which bid the "link to a sub" sheet is open for, and why each linked bid
  // is linked — a join key the app filled in silently is how the wrong sub
  // ends up on a signed subcontract with nobody able to see it happened.
  const [linkTargetBidId, setLinkTargetBidId] = useState<string | null>(null);
  const [linkNotes, setLinkNotes] = useState<Record<string, string>>({});

  const loadInvites = useCallback(async () => {
    if (!packageId) return;
    const rows = await fetchBidInvites(packageId);
    // A read that failed is not an empty list. Keep whatever we last had and
    // say so — "Nobody invited yet" over a dropped read sends the GC to invite
    // subs who are already holding a live link.
    if (rows === null) {
      setInvitesFailed(true);
      setPendingInvites(await loadPendingBidInvites());
      return;
    }
    setInvitesFailed(false);
    setServerInvites(rows);
    // Invites filed offline that are now on the server get their email — the
    // same token, through remindBidInvites (#14). Cleared only when notify
    // handled it; a refusal keeps the row's "Not emailed" marker.
    const delivered = await deliverPendingBidInvites(rows, new Set([packageId]));
    const sent = delivered.filter(r => r.emailed);
    if (sent.length > 0) {
      setDeliveredNote(`Emailed ${sent.map(r => r.email).join(', ')} — ${sent.length === 1 ? 'that invite was' : 'those invites were'} saved offline and ${sent.length === 1 ? 'has' : 'have'} now uploaded.`);
    }
    const refused = delivered.filter(r => !r.emailed && r.reason);
    if (refused.length > 0) {
      setNotEmailed(prev => ({ ...prev, ...Object.fromEntries(refused.map(r => [r.inviteId, r.reason as string])) }));
    }
    setPendingInvites(await loadPendingBidInvites());
  }, [packageId]);

  // On FOCUS, not on mount (#15): a sub files his number through the link
  // while the GC is on another screen, and coming back must show it without
  // leaving the package and re-entering.
  useFocusEffect(useCallback(() => { void loadInvites(); }, [loadInvites]));

  // The queue uploading an offline invite is the moment its email can go.
  useEffect(() => onQueueFlushed(tables => {
    if (tables.has('bid_package_invites')) void loadInvites();
  }), [loadInvites]);

  const invites = useMemo(
    () => mergeInvitesWithPending(serverInvites, pendingInvites, packageId ?? '', Date.now()),
    [serverInvites, pendingInvites, packageId],
  );

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

  // ── The roster, as bid candidates ────────────────────────────
  // Subs on this job (an empty `assignedProjects` means "available everywhere",
  // which is how the rest of the app reads it), trade-matched ones first.
  //
  // The ordering is a SUGGESTION and never a filter: a GC invites the drywall
  // sub to price the ceiling package all the time, and hiding him would be the
  // app deciding something it does not know. utils/subTradeMatch.ts makes the
  // same argument the other way — it refuses to ASSIGN unless exactly one sub
  // carries the trade — and `packageMatch` below is that refusal, used here
  // only to label one row.
  const tradeKey = useMemo(() => normalizeTradeKey(pkg?.phase || pkg?.name || ''), [pkg?.phase, pkg?.name]);
  const roster = useMemo(() => {
    if (!pkg) return [] as Subcontractor[];
    const onJob = subcontractors.filter(s =>
      !s.assignedProjects?.length || s.assignedProjects.includes(pkg.projectId));
    return [...onJob].sort((a, b) => {
      const am = normalizeTradeKey(a.trade) === tradeKey ? 0 : 1;
      const bm = normalizeTradeKey(b.trade) === tradeKey ? 0 : 1;
      return am - bm || a.companyName.localeCompare(b.companyName);
    });
  }, [subcontractors, pkg, tradeKey]);

  // The one unambiguous trade match, if there is one. Same function the
  // scheduler uses, so "the only plumbing sub on this job" means the same thing
  // on both screens.
  const packageMatch = useMemo(() => {
    if (!pkg) return null;
    const outcome = matchSubForPhase(pkg.phase || pkg.name, roster, pkg.projectId);
    return outcome.matched ? outcome.match : null;
  }, [pkg, roster]);

  // ── Scope of work: generate, edit, persist ───────────────────
  const handleGenerateScope = useCallback(() => {
    const generated = estimateItemsToScope(packageItems);
    if (!generated) return;
    setScopeDraft(generated);
    setShowScopeEdit(true);
  }, [packageItems]);

  const handleSaveScope = useCallback(() => {
    if (!pkg) return;
    const next = scopeDraft.trim();
    updateBidPackage(pkg.id, { scopeDescription: next || undefined });
    setShowScopeEdit(false);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [pkg, scopeDraft, updateBidPackage]);

  // ── Recover the sub behind a bid that arrived anonymous ──────
  // A picker in the invite sheet only fixes bids filed after today. Every bid
  // already in the matrix, plus every bid added by voice or by hand, still
  // carries no `subcontractorId` — and that is the key `sub-portals` refuses to
  // work without (`if (!c.subcontractorId) continue`), the key the scorecard
  // attributes commitments by, and the key the award compliance lookup needs.
  //
  // So link them here, from evidence already on the device: the invite we sent
  // names the address, and the roster names the address's owner. Ambiguity
  // refuses (utils/bidInviteCore.ts) and the refusals get the manual control on
  // the bid card. Each bid is attempted once per screen mount — a write that
  // does not stick must not re-arm the effect into a loop.
  const autoLinkedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const bid of bids) {
      if (bid.subcontractorId || autoLinkedRef.current.has(bid.id)) continue;
      const link = resolveBidSubcontractor(bid, invites, subcontractors);
      if (!link) continue;
      autoLinkedRef.current.add(bid.id);
      updateBidPackageBid(bid.id, { subcontractorId: link.subId });
      setLinkNotes(prev => ({ ...prev, [bid.id]: link.reason }));
    }
  }, [bids, invites, subcontractors, updateBidPackageBid]);

  // `inviteSending` drives the button's disabled prop, but state lands a frame
  // later — a double tap on "Send invitations" both get through and every sub
  // is minted TWO live tokens. `bid_invite_submit` blocks a second submit per
  // INVITE, not per bidder, so that sub can file two bids and the levelling
  // matrix shows one company as two competing bidders. This latch is a ref
  // because it has to be true on the second tap's synchronous read.
  const invitingRef = useRef(false);
  const remindingRef = useRef(false);

  const handleSendInvites = useCallback(async () => {
    if (!pkg || !project) return;
    if (invitingRef.current) return;
    const uid = user?.id;
    if (!uid) {
      showAlert('Sign in first', 'An invite is filed against your account, so it needs a signed-in session. Sign in and try again.');
      return;
    }
    // A scope-less invite is worse than no invite: the sub gets an email headed
    // "You're invited to bid on Plumbing rough-in" with a CSI number and a
    // button, and the landing page tells him to email the contractor for the
    // details. The button that opened this sheet is disabled for exactly this
    // reason and says so; this is the defensive half of that gate.
    if (!scopeText) {
      showAlert(
        'No scope to send',
        'This package has no scope of work written, so the invitation would ask the sub to price a name and an address — and the bid page would tell him to phone you for the details. Write the scope first; if the package has estimate items linked, one tap fills it in.',
      );
      return;
    }
    const { recipients: typed, rejected } = parseInviteEmails(inviteEmails);
    // Picked-off-the-roster subs carry their id from the start. Typed addresses
    // get one attached when they exactly match a sub already on file, so
    // "joe@acemech.com" typed from memory is still Ace Mechanical.
    const pickedRecipients: InviteRecipient[] = pickedSubIds
      .map(id => subcontractors.find(s => s.id === id))
      .filter((s): s is Subcontractor => !!s && !!s.email.trim())
      .map(s => ({ email: s.email.trim(), name: s.companyName, subcontractorId: s.id }));
    const seenEmail = new Set(pickedRecipients.map(r => r.email.toLowerCase()));
    const recipients: InviteRecipient[] = [
      ...pickedRecipients,
      // De-duplicated against the picks: a sub both ticked and typed would
      // otherwise be minted two live tokens, and `bid_invite_submit` blocks a
      // second submit per INVITE rather than per bidder — so one company could
      // file two bids that the matrix shows as two competing subs.
      ...attachRosterIds(typed, subcontractors).filter(r => !seenEmail.has(r.email.toLowerCase())),
    ];
    if (recipients.length === 0) {
      showAlert(
        'No email addresses',
        rejected.length > 0
          ? `Couldn't read ${rejected.slice(0, 3).join(', ')} as an email address. One address per line, or separated by commas.`
          : "Pick subs from your roster above, or type their email addresses — one per line, or separated by commas.",
      );
      return;
    }
    // Anyone already holding a live link is skipped rather than given a second
    // token; expired and already-answered invites go through, because sending
    // those again is a deliberate re-invitation. `invites` includes the ones
    // still on this phone (#14): an offline re-send must not mint a second
    // token for a sub whose first one simply has not uploaded yet.
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
          bidsDueAt: pkg.dueDate,
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
        // Honest about WHEN (#14): the email goes once the row uploads, and
        // only while this package or the Buyout list is open to send it.
        lines.push(`${queued.length} invite${queued.length === 1 ? '' : 's'} saved on this phone — you're offline, so nothing has gone to ${queued.length === 1 ? 'that sub' : 'those subs'} yet. The email goes out once ${queued.length === 1 ? 'it uploads' : 'they upload'} (with this package or the Buyout list open); until then ${queued.length === 1 ? 'it shows' : 'they show'} below as "On this phone" and the link won't open.`);
      }
      if (failed.length > 0) {
        lines.push(`${failed.length} couldn't be filed: ${failed.map(f => f.email).join(', ')}. Try again in a minute.`);
      }
      const unmailed = synced.filter(r => !r.emailed);
      if (synced.length > 0 && mailed.length === 0) {
        lines.push('We could not hand the email off, so nothing has reached them yet — copy each link from the list below and text or email it over.');
      } else if (synced.length > mailed.length) {
        lines.push(`${synced.length - mailed.length} of those emails did not hand off — copy those links from the list below and send them yourself.`);
      }
      // Name the ones notify refused for a reason he must act on differently
      // (#94): re-sending to an unsubscribed sub mails nobody.
      for (const r of unmailed) {
        if (r.reason === 'suppressed_unsubscribed' || r.reason === 'no_recipient') lines.push(notEmailedSentence(r.email, r.reason));
      }
      if (unmailed.length > 0) {
        setNotEmailed(prev => ({ ...prev, ...Object.fromEntries(unmailed.map(r => [r.inviteId, r.reason ?? 'refused'])) }));
      }
      if (copied) lines.push('The link is on your clipboard.');
      if (alreadyLive.length > 0) {
        lines.push(`Skipped (already holding a live link): ${alreadyLive.slice(0, 3).join(', ')}.`);
      }
      if (rejected.length > 0) lines.push(`Skipped (not an email address): ${rejected.slice(0, 3).join(', ')}.`);

      setShowInvite(false);
      setInviteEmails('');
      setPickedSubIds([]);
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
  }, [pkg, project, user, inviteEmails, settings, loadInvites, invites, scopeText, pickedSubIds, subcontractors]);

  // ── Chase the ones who have gone quiet ───────────────────────
  // The coverage banner said "2 invited subs haven't answered yet — chase
  // them" and offered no way to. This re-fires the invite email against each
  // awaiting invite's EXISTING token: no second row, no second token, no
  // second bid slot for the same company.
  const handleRemind = useCallback(async () => {
    if (!pkg || !project) return;
    // Same reason as `invitingRef`: `reminding` drives the disabled prop and
    // lands a frame later, so a double tap sends every waiting sub the chase
    // email twice.
    if (remindingRef.current) return;
    const uid = user?.id;
    if (!uid) {
      showAlert('Sign in first', 'Reminders go out against your account, so they need a signed-in session.');
      return;
    }
    // A pending invite has no live link to chase until it uploads.
    const awaiting = remindableInvites(invites.filter(i => !i.localOnly), Date.now());
    if (awaiting.length === 0) return;
    remindingRef.current = true;
    setReminding(true);
    try {
      const results = await remindBidInvites(
        {
          userId: uid,
          packageId: pkg.id,
          projectId: pkg.projectId,
          packageName: pkg.name,
          projectName: project.name,
          csiDivision: pkg.csiDivision,
          phase: pkg.phase,
          scopeDescription: pkg.scopeDescription,
          bidsDueAt: pkg.dueDate,
          replyToEmail: settings?.branding?.email,
        },
        awaiting,
      );
      const sent = results.filter(r => r.emailed);
      setRemindedIds(sent.map(r => r.inviteId));
      const lines: string[] = [];
      if (sent.length > 0) {
        lines.push(`Re-sent the invitation to ${sent.length} sub${sent.length === 1 ? '' : 's'}: ${sent.map(r => r.email).join(', ')}. Same link as before — they can still only file one bid.`);
      }
      const missed = results.filter(r => !r.emailed);
      if (missed.length > 0) {
        // The link is live either way; he just has to be the one carrying it —
        // and an unsubscribed sub is named, because chasing him again by email
        // can never arrive (#94).
        for (const r of missed) lines.push(notEmailedSentence(r.email, r.reason));
        lines.push('Their link still works — copy it from the list and text it over.');
      }
      setNotEmailed(prev => {
        const next = { ...prev };
        for (const r of results) {
          if (r.emailed) delete next[r.inviteId];
          else next[r.inviteId] = r.reason ?? 'refused';
        }
        return next;
      });
      setPendingInvites(await loadPendingBidInvites());
      if (Platform.OS !== 'web' && sent.length > 0) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert(sent.length > 0 ? 'Chased' : 'Nothing was emailed', lines.join('\n\n'));
    } finally {
      remindingRef.current = false;
      setReminding(false);
    }
  }, [pkg, project, user, invites, settings]);

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
  // A bid with no dollar amount is not a bid (#95). It used to be saved at $0,
  // sort first with a LOWEST badge and offer "Award · $0" — an award
  // ProjectContext refuses without a word. When the parser catches no amount
  // the Add-bid sheet opens with what it did catch, to be finished by hand; a
  // parse that caught nothing keeps the raw dictation in Includes so the
  // words are not lost.
  const handleVoiceBid = useCallback(async (transcript: string) => {
    if (!pkg) return;
    const partial = await parseBidFromTranscript(transcript);
    const amount = partial.amount ? parseBidAmountInput(String(partial.amount)) : null;
    if (amount == null) {
      const caughtNothing = !partial.vendorName && !partial.includes && !partial.excludes && !partial.terms;
      setNewVendor(partial.vendorName || '');
      setNewAmount('');
      setNewIncludes(caughtNothing ? transcript.trim() : (partial.includes || ''));
      setNewExcludes(partial.excludes || '');
      setNewTerms(partial.terms || '');
      setAddBidNote(caughtNothing
        ? "We couldn't read that bid — your words are in Includes. Fill in the vendor and the amount."
        : "We didn't catch a dollar amount — type it in.");
      setShowAddBid(true);
      return;
    }
    addBidPackageBid({
      packageId: pkg.id,
      vendorName: partial.vendorName || 'Voice-captured bid',
      amount,
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
    if (!newVendor.trim()) {
      showAlert('Missing info', 'Who is the bid from? Put the vendor name on it.');
      return;
    }
    // Separators and "$" stripped before Number() — "4,800" used to store NaN,
    // which the server's NOT NULL amount then refused in the queue (#95).
    const amount = parseBidAmountInput(newAmount);
    if (amount == null) {
      showAlert('Needs an amount', newAmount.trim()
        ? `Couldn't read "${newAmount.trim()}" as a dollar amount. Type the total, like 4800 or 4,800.50.`
        : "Type the bid's total in dollars — a bid without one can't be compared or awarded.");
      return;
    }
    addBidPackageBid({
      packageId: pkg.id,
      vendorName: newVendor.trim(),
      amount,
      includes: newIncludes.trim() || undefined,
      excludes: newExcludes.trim() || undefined,
      terms: newTerms.trim() || undefined,
      source: 'manual',
      status: 'received',
    });
    setShowAddBid(false);
    setAddBidNote(null);
    setNewVendor(''); setNewAmount(''); setNewIncludes(''); setNewExcludes(''); setNewTerms('');
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [pkg, newVendor, newAmount, newIncludes, newExcludes, newTerms, addBidPackageBid]);

  // ── Fix a bid's amount on its card (#95) ─────────────────────
  const handleSaveAmount = useCallback(() => {
    if (!amountEditBidId) return;
    const amount = parseBidAmountInput(amountDraft);
    if (amount == null) {
      showAlert('Needs an amount', "Type the bid's total in dollars, like 4800 or 4,800.50.");
      return;
    }
    updateBidPackageBid(amountEditBidId, { amount });
    setAmountEditBidId(null);
    setAmountDraft('');
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [amountEditBidId, amountDraft, updateBidPackageBid]);

  // ── Delete a bid — behind a confirm (#92) ────────────────────
  // One brush of a small trash icon used to delete a bid outright, including
  // the number a sub filed himself through his link — which is then closed
  // for good (bid_invite_submit takes one bid per invite).
  const handleDeleteBid = useCallback((bid: BidPackageBid, filedBySub: boolean) => {
    if (!pkg) return;
    const who = bid.vendorName || 'this sub';
    if (bid.status === 'awarded' || pkg.awardedBidId === bid.id) {
      showAlert(
        "Can't delete the awarded bid",
        `${who}'s bid is the one this package was awarded on — the commitment and the buyout savings are built from it. It stays.`,
      );
      return;
    }
    const amount = bidAmountOf(bid);
    const lines = [`Delete ${who}'s bid${amount != null ? ` of ${formatMoney(amount)}` : ''}? This can't be undone.`];
    if (filedBySub) {
      lines.push(`This is the number ${who} filed through their own link. That link is closed now, so to get a number from them again you'll need to re-invite them.`);
    }
    showAlert('Delete this bid?', lines.join('\n\n'), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete bid', style: 'destructive', onPress: () => deleteBidPackageBid(bid.id) },
    ]);
  }, [pkg, deleteBidPackageBid]);

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
  // The compliance gate, re-weighted against what the app actually knows.
  //
  // It used to push a blocker for ANY bid with no prequal packet — and
  // `prequal_packets` is empty in production, while `bid.subcontractorId` was
  // never set by anything, so EVERY award went through the red destructive
  // "Award & accept risk" double-confirm. A GC who sees that screen on every
  // award for three months stops reading it, which is exactly when the one sub
  // whose COI really has lapsed goes through.
  //
  // So: the COI the app keeps up to date is the evidence — read from the
  // certificates in the COI vault, falling back to the date on the roster
  // record. Absent or expired is a blocker; it is the thing the gate is for.
  // The licence leg and a missing prequal packet are NOTES. Screen audit
  // 2026-09-16: this used to gate on `getComplianceStatus`, which returns
  // 'unknown' when EITHER date is missing — so a sub with a current,
  // vault-verified COI and no typed licence date (the common case) was still
  // blocked. utils/subCompliance.reviewAwardCompliance splits the legs and is
  // pinned by scripts/validate-sub-network.ts.
  const handleAward = useCallback((bid: BidPackageBid) => {
    if (!pkg) return;
    // An award ProjectContext is certain to refuse must not walk him through
    // the compliance and risk-override dialogs first (#95).
    if (bidAmountOf(bid) == null) {
      showAlert('Needs an amount', `${bid.vendorName || 'This bid'} has no dollar amount, so it can't be awarded. Tap the amount on the card to add it first.`);
      return;
    }
    // One savings figure everywhere: the leveled one (the awarded sub does not
    // cover excluded scope, so it is not saved money). The package hero and
    // buyout.tsx read the same helper off the awarded bid (audit round 2, #5).
    const total = leveledBidTotal(bid);
    const savings = leveledBuyoutSavings(pkg.estimateBudget, bid);
    const uncovered = uncoveredScopeOf(bid);

    const sub = bid.subcontractorId ? getSubcontractor(bid.subcontractorId) : null;
    const packet = sub
      ? prequalPackets.find(p => p.subcontractorId === sub.id)
      : null;

    // D4-1: structured blocker evaluation via prequalEngine — run only on a
    // SUBMITTED packet (Q5): an invited one is blank because the sub has not
    // filled it in yet, and an approved/rejected one carries the GC's decision.
    const review = packet && packet.status === 'submitted' ? reviewPrequalPacket(packet) : null;
    const blockers: string[] = [];
    const notes: string[] = [];
    const now = Date.now();
    const subCerts = sub ? getCOIsForSub(sub.id) : [];
    const award = sub
      ? reviewAwardCompliance(sub, now, {
          vaultCoiExpiry: subCoiExpiryAcross(subCerts),
          vaultCertCount: subCerts.length,
        })
      : null;

    if (!sub) {
      // Actionable, not a shrug: the bid card carries the control that fixes it.
      blockers.push('This bid is not linked to a sub on your roster, so no licence or COI has been checked — and the commitment it creates cannot be given a sub portal. Use "Link this bid to a sub" on the bid card first.');
    } else if (award) {
      blockers.push(...award.blockers);
      notes.push(...award.notes);
      if (!packet) {
        // A note, not a blocker: the prequal form is a separate invite the bid
        // invite never mentioned. Offered as one tap below ("Request prequal").
        notes.push(`No prequal packet on file for ${sub.companyName} — paperwork you may have chosen not to run on this job, not an insurance gap.`);
      } else {
        // Q5: the packet's STATUS decides, not a re-run of the auto-review on
        // whatever it holds — invited-but-unfilled is pending (a note), and the
        // GC's own Reject is a blocker. Rules: utils/prequalAwardGate.ts,
        // pinned by scripts/validate-prequal-engine.ts (section 9).
        const leg = prequalAwardLeg(packet, review, sub.companyName, now);
        blockers.push(...leg.blockers);
        notes.push(...leg.notes);
      }
    }
    const isRisky = blockers.length > 0;

    const lines: string[] = [];
    lines.push(`Vendor: ${sub?.companyName ?? bid.vendorName ?? 'Subcontractor'}`);
    lines.push(`Leveled total: ${formatMoney(total)}`);
    if (sellBasis) {
      // A budget stored at SELL makes his own markup read as savings (#11).
      lines.push('Buyout savings: not shown — this package\'s budget includes your markup. Review the budget on this screen.');
    } else {
      lines.push(`Buyout ${savings >= 0 ? 'savings' : 'overrun'} vs. budget at cost: ${formatMoney(Math.abs(savings))}`);
    }
    if (uncovered > 0) {
      // Say what the leveling took out of the savings and that it is still
      // his to buy — the commitment is the sub's bid, not the leveled total.
      // No commitment is booked for that scope (it is not bought yet); the
      // package hero and Job Costing carry it as uncommitted, estimated scope.
      lines.push(`Commitment: ${formatMoney(bid.amount)} (the sub's bid). ${formatMoney(uncovered)} (est.) for ${bid.excludes || 'the scope this bid excludes'} is not in it — still yours to buy, not counted as savings.`);
    }
    if (allowanceItems.length > 0) {
      lines.push('');
      lines.push(`- ${allowanceItems.length} allowance item${allowanceItems.length === 1 ? '' : 's'} will lock to firm price.`);
    }
    if (notes.length > 0) {
      lines.push('');
      for (const n of notes) lines.push(`- ${n}`);
    }
    lines.push('');
    lines.push('Awarding will create a Commitment and mark this package complete.');

    const doAward = () => {
      // D4-1: the override audit line rides INTO the award. It used to be a
      // follow-up updateCommitment, which maps this render's commitments list
      // — one that does not hold the commitment just created — so it dropped
      // the new commitment from the device until the next reload.
      const overrideNote = isRisky
        ? `[risk-override ${new Date().toISOString().slice(0, 10)}] Awarded despite: ${blockers.join('; ')}. Acknowledged by GC.`
        : undefined;
      const commitmentId = awardBidPackage(pkg.id, bid.id, { overrideNote });
      if (!commitmentId) {
        // awardBidPackage refuses a bid with no amount or from another package
        // and used to do so in silence — the dialog closed and nothing happened.
        showAlert('Not awarded', `${bid.vendorName || 'This bid'} could not be awarded — it has no dollar amount on this device. Fix the amount on the card and award again.`);
        return;
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };

    if (!isRisky) {
      showAlert(
        'Award this bid?',
        lines.join('\n'),
        [
          { text: 'Cancel', style: 'cancel' },
          // The answer to "no prequal packet" is one tap, not a trip to another
          // screen: prequal-manager opens its invite sheet for this sub.
          ...(sub && !packet ? [{
            text: 'Request prequal', style: 'default' as const,
            onPress: () => router.push({ pathname: '/prequal-manager', params: { inviteSubId: sub.id } } as never),
          }] : []),
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
          // The unlinked case has a fix that takes one tap, so offer it here
          // rather than sending him down the destructive path to work around a
          // blocker that is really a missing join.
          ...(!sub ? [{ text: 'Pick the sub', style: 'default' as const, onPress: () => setLinkTargetBidId(bid.id) }] : []),
          // Same for a missing or lapsed COI: the vault is where the fix lives.
          // Opens on THIS sub's certificates (#23), not the whole vault.
          ...(sub && award && (award.coi === 'none' || award.coi === 'expired')
            ? [{ text: 'Open COI vault', style: 'default' as const, onPress: () => router.push({ pathname: '/coi-vault', params: { subId: sub.id } } as never) }]
            : []),
          {
            text: 'Review override',
            style: 'destructive',
            onPress: () => showAlert(
              'Confirm risk override',
              `Award ${sub?.companyName ?? bid.vendorName ?? 'this sub'} despite:\n\n${blockers.map(b => '• ' + b).join('\n')}\n\nThis is the GC's compliance risk and will be recorded.`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Award & accept risk', style: 'destructive', onPress: doAward },
              ],
            ),
          },
        ],
      );
    }
  }, [pkg, awardBidPackage, getSubcontractor, getCOIsForSub, prequalPackets, allowanceItems, router, sellBasis]);

  // Generate the A401-styled subcontract PDF for the awarded sub: scope and
  // CSI division from the package, the parties from the awarded bid and the
  // GC's branding. The PDF is printed as generated — nothing on it is editable
  // after the fact — so every term it carries has to be a fact or a blank:
  //   - the NUMBER is the award commitment's own ("BO-3", #98), the one the
  //     sub portal and lien waivers already use; no commitment, no number;
  //   - the SUM is the commitment's amount, so a commitment edited after award
  //     and its subcontract say the same thing;
  //   - RETAINAGE comes from resolveRetainagePercent with its source, confirmed
  //     here before rendering; with no rate on file he picks a blank "to be
  //     agreed" line or goes and records one — never a silent 10%.
  const handleGenerateSubcontract = useCallback(() => {
    if (!pkg || !pkg.awardedBidId || !project) return;
    const winningBid = bids.find(b => b.id === pkg.awardedBidId);
    if (!winningBid) {
      showAlert('No awarded bid', 'Award a bid before generating the subcontract.');
      return;
    }
    const commitment = awardedCommitmentOf(pkg, commitments);
    if (!commitment || !commitment.number) {
      showAlert(
        'No subcontract number yet',
        'Subcontract number assigned on award — the award\'s commitment isn\'t on this device yet, so there is no number to print. Open the project once it has synced and try again.',
      );
      return;
    }
    const branding = settings?.branding ?? { companyName: 'MAGE ID', address: '', phone: '', email: '', licenseNumber: '', tagline: '', contactName: '' };
    const ownerName = (project.clientPortal?.invites?.[0]?.name) ?? (project as { owner?: string }).owner ?? 'Owner';
    const render = async (retainagePercent: number | null) => {
      try {
        const data: A401Data = {
          subcontractNumber: commitment.number,
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
          contractSum: commitment.amount,
          retainagePercent,
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
        // A blocked PDF window on web says so (CONTRACT 25); no success haptic.
        showAlert('Could not generate subcontract', pdfFailureMessage(err, err instanceof Error ? err.message : 'Try again.'));
      }
    };
    const retainage = resolveRetainagePercent({
      project,
      priorInvoices: getInvoicesForProject(project.id),
      payApps: getAIAPayAppsForProject(project.id),
    });
    if (retainage.needsAsk) {
      showAlert(
        'Retainage on this subcontract',
        `No retainage rate is on file for ${project.name} — not on its contract terms, an invoice or a pay application. The subcontract can print the retainage line blank ("____% — to be agreed") for you and ${winningBid.vendorName ?? 'the sub'} to fill in, or you can record the job's rate on the project first.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Set it on the project', style: 'default', onPress: () => router.push({ pathname: '/project-detail' as never, params: { id: project.id } as never }) },
          { text: 'Print it blank', style: 'default', onPress: () => { void render(null); } },
        ],
      );
      return;
    }
    showAlert(
      'Retainage on this subcontract',
      `${retainage.percent}% — ${retainage.label}. A sub's rate can be lower than the job's; if yours for ${winningBid.vendorName ?? 'this sub'} differs, print it blank and write it in.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Print it blank', style: 'default', onPress: () => { void render(null); } },
        { text: `Use ${retainage.percent}%`, style: 'default', onPress: () => { void render(retainage.percent); } },
      ],
    );
  }, [pkg, bids, project, settings, commitments, getInvoicesForProject, getAIAPayAppsForProject, router]);

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

  // Sort bids by leveled total ascending — winning bid floats up. A bid with
  // no usable amount sorts LAST (#95): at $0 it used to float to the top and
  // wear the LOWEST badge.
  const sortedBids = [...bids].sort(compareBidsForMatrix);
  const pricedBids = sortedBids.filter(b => bidAmountOf(b) != null);
  const winningBidId = levelingResult?.recommendedWinnerBidId;

  // ── Outlier detection (industry standard: >15% from median = review).
  // Per Buildr / Archdesk research: a bid significantly below the median
  // is almost always missing scope; significantly above usually means the
  // sub priced in protection / unfamiliarity. Either way, the GC needs to
  // pause before awarding. We compute against the leveled total so the
  // AI's adjustments are already factored in.
  // Priced bids only — a $0 or unreadable bid would drag the median down and
  // mark every real bid HIGH.
  const leveledTotals = pricedBids.map(b => b.amount + (b.normalizedAdjustment ?? 0));
  const median = leveledTotals.length === 0 ? 0
    : leveledTotals.length % 2 === 1
      ? leveledTotals[Math.floor(leveledTotals.length / 2)]
      : (leveledTotals[leveledTotals.length / 2 - 1] + leveledTotals[leveledTotals.length / 2]) / 2;
  const isOutlier = (bid: BidPackageBid): { kind: 'low' | 'high'; pct: number } | null => {
    if (median === 0 || pricedBids.length < 2 || bidAmountOf(bid) == null) return null;
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

  // The two things the chase needs: when the number is wanted, and who still
  // owes one. `dueDate` is the field the create sheet writes — `requiredByDate`
  // has no writer anywhere in the repo and must not be read as a fact.
  const dueState = bidDueState(pkg.dueDate, Date.now());
  const remindable = remindableInvites(invites.filter(i => !i.localOnly), Date.now());

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
                <Text style={styles.heroBudgetLabel}>{sellBasis ? 'Budget (includes markup)' : 'Budget at cost'}</Text>
                <Text style={styles.heroBudgetValue}>{formatMoney(pkg.estimateBudget)}</Text>
              </View>
              {sellBasis ? (
                <View style={styles.heroBudgetCell}>
                  <Text style={styles.heroBudgetLabel}>Buyout savings</Text>
                  <Text style={[styles.heroBudgetValue, { color: Colors.warningLabel }]}>Review</Text>
                </View>
              ) : heroSavings != null ? (
                <View style={styles.heroBudgetCell}>
                  <Text style={styles.heroBudgetLabel}>Buyout {heroSavings >= 0 ? 'savings' : 'overrun'}</Text>
                  <Text style={[styles.heroBudgetValue, { color: heroSavings >= 0 ? themeColors.success : themeColors.danger }]}>
                    {heroSavings >= 0 ? '+' : ''}{formatMoney(heroSavings)}
                  </Text>
                  {heroUncovered > 0 ? (
                    <Text style={styles.heroBudgetLabel}>{formatMoney(heroUncovered)} excluded scope (est. at award)</Text>
                  ) : null}
                </View>
              ) : (
                <View style={styles.heroBudgetCell}>
                  <Text style={styles.heroBudgetLabel}>Bids received</Text>
                  <Text style={styles.heroBudgetValue}>{bids.length}</Text>
                </View>
              )}
            </View>
          </View>

          {/* #11: a budget stored at SELL makes his own markup read as buyout
              savings (and, on the client PDF, as "Bulk Savings"). Withheld
              everywhere until he fixes it — one tap to the cost figure. */}
          {sellBasis && (
            <View style={styles.section}>
              <View style={styles.warningCard}>
                <AlertTriangle size={14} color={Colors.warningLabel} strokeWidth={1.75} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.warningTitle}>Budget includes markup — review</Text>
                  <Text style={styles.warningBody}>
                    This package was budgeted at the estimate&apos;s sell price ({formatMoney(pkg.estimateBudget)}), so a sub who bids your cost would show your own markup as buyout savings — and that figure would print on the client&apos;s estimate as Bulk Savings. Savings are hidden until the budget is at cost{costBudget != null ? ` (${formatMoney(costBudget)} for its linked lines)` : ''}.
                  </Text>
                  {costBudget != null && (
                    <TouchableOpacity
                      style={styles.warningActionBtn}
                      onPress={() => showAlert(
                        'Set the budget to cost?',
                        `${formatMoney(pkg.estimateBudget)} → ${formatMoney(costBudget)}, the cost of the ${pkg.linkedEstimateItemIds.length} estimate line${pkg.linkedEstimateItemIds.length === 1 ? '' : 's'} this package covers, before your markup. Buyout savings are then measured against what the work costs you.`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Set to cost', style: 'default', onPress: () => updateBidPackage(pkg.id, { estimateBudget: costBudget }) },
                        ],
                      )}
                      activeOpacity={0.85}
                      testID="budget-to-cost"
                    >
                      <Text style={styles.warningActionText}>Set the budget to cost · {formatMoney(costBudget)}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          )}

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
                      Awarding this package locks them to firm price in the estimate and client portal.
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
                    {/* Same gate as the section button below — a second door
                        into the invite sheet must not walk around the scope
                        check, or the coverage warning becomes the way to send
                        a scope-less RFQ. */}
                    <TouchableOpacity
                      style={[styles.warningActionBtn, !scopeText && styles.inviteBtnBlocked]}
                      onPress={() => { if (scopeText) setShowInvite(true); }}
                      disabled={!scopeText}
                      activeOpacity={0.85}
                      testID="coverage-invite-subs"
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !scopeText }}
                      accessibilityLabel={scopeText
                        ? 'Invite subs to bid'
                        : 'Invite subs to bid — unavailable until this package has a scope of work'}
                    >
                      <Mail size={13} color={scopeText ? Colors.warningLabel : themeColors.textMuted} strokeWidth={1.75} />
                      <Text style={[styles.warningActionText, !scopeText && { color: themeColors.textMuted }]}>
                        {scopeText ? 'Invite subs to bid' : 'Write the scope first, then invite'}
                      </Text>
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

          {/* Scope of work — the only thing the bidder is told about the job.
              Shown ABOVE the invite section on purpose: it has to be written
              before the invitation means anything, and the send button below
              is disabled until it is. */}
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Scope of work</Text>
              <Text style={styles.sectionSub}>{scopeText ? 'What the subs are pricing' : 'Not written yet'}</Text>
            </View>
            {scopeText ? (
              <View style={styles.scopeCard}>
                <Text style={styles.scopeText}>{scopeText}</Text>
                <TouchableOpacity
                  style={styles.scopeEditBtn}
                  onPress={() => { setScopeDraft(scopeText); setShowScopeEdit(true); }}
                  activeOpacity={0.85}
                  testID="scope-edit"
                >
                  <FileText size={14} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.scopeEditText}>Edit the scope</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.scopeCard}>
                <Text style={styles.scopeEmptyText}>
                  {canGenerateScope(packageItems)
                    ? `This package covers ${packageItems.length} estimate line${packageItems.length === 1 ? '' : 's'}. Write them out as a scope and the sub knows what he is pricing — quantities and units only, never your carry.`
                    : 'Nothing is linked to this package from the estimate, so there is nothing to generate from. Type the scope yourself — without it the invitation asks the sub to price a name and an address, and the bid page tells him to phone you.'}
                </Text>
                <View style={styles.scopeBtnRow}>
                  {canGenerateScope(packageItems) && (
                    <TouchableOpacity
                      style={styles.scopeGenBtn}
                      onPress={handleGenerateScope}
                      activeOpacity={0.85}
                      testID="scope-generate"
                    >
                      <FileText size={14} color="#FFF" strokeWidth={1.75} />
                      <Text style={styles.scopeGenText}>Write it from the estimate items</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.scopeEditBtn}
                    onPress={() => { setScopeDraft(''); setShowScopeEdit(true); }}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.scopeEditText}>Type it</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

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

              {/* When the number is wanted. Shown here because this is the
                  section he chases from; the invite email and the sub's bid
                  page print the same day (#99). */}
              <View style={styles.dueRow}>
                <Clock
                  size={Type.caption1.fontSize}
                  color={dueState === 'overdue' ? themeColors.danger : dueState === 'none' ? themeColors.textMuted : themeColors.accent}
                  strokeWidth={2}
                />
                <Text style={[styles.dueRowText, dueState === 'overdue' && { color: themeColors.danger, fontWeight: '700' }]}>
                  {pkg.dueDate
                    ? `${bidDueLabel(pkg.dueDate, Date.now())} · ${formatCalendarDay(pkg.dueDate, { weekday: 'short', month: 'short', day: 'numeric' })}`
                    : 'No bid date on this package — nothing here can tell you it is late.'}
                </Text>
              </View>

              {!!deliveredNote && (
                <View style={[styles.warningCard, { marginBottom: 8, backgroundColor: themeColors.success + '14', borderLeftColor: themeColors.success }]}>
                  <CheckCircle2 size={14} color={themeColors.success} strokeWidth={1.75} />
                  <Text style={[styles.warningBody, { flex: 1, marginTop: 0 }]}>{deliveredNote}</Text>
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
                  // The bid this invite produced was deleted (trigger
                  // trg_bid_package_bids_clear_invite, #92): the link stays
                  // closed, so the way back is a fresh invite.
                  const bidGone = state === 'responded' && (inv.status === 'bid_deleted' || !inv.bidId);
                  const unmailedWhy = !inv.localOnly && state === 'awaiting'
                    ? (notEmailed[inv.id] ?? inv.notEmailedReason)
                    : undefined;
                  return (
                    <View key={inv.id} style={styles.inviteCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.inviteWho} numberOfLines={1}>{inv.subName || inv.subEmail}</Text>
                        <Text style={styles.inviteMeta} numberOfLines={2}>
                          {inv.localOnly
                            ? 'On this phone — will email when it uploads'
                            : <>
                                {sentDay ? `Sent ${sentDay}` : 'Sent'}
                                {remindedIds.includes(inv.id) ? ' · re-sent just now' : ''}
                                {state === 'awaiting' && expiryDay ? ` · link good through ${expiryDay}` : ''}
                                {state === 'responded' && !bidGone ? ' · their number is in the matrix below' : ''}
                                {bidGone ? ' · their bid was deleted — re-invite them for a new number' : ''}
                              </>}
                        </Text>
                        {!!unmailedWhy && (
                          <Text style={[styles.inviteMeta, { color: Colors.warningLabel, fontWeight: '700' }]} numberOfLines={2}>
                            {unmailedWhy === 'suppressed_unsubscribed'
                              ? 'Not emailed — they unsubscribed from invitation emails. Copy the link and text it.'
                              : NOT_EMAILED_ROW}
                          </Text>
                        )}
                        {/* An invite filed against a roster sub is what gives
                            the resulting bid a scorecard, a commitment that
                            knows who it is with, and a sub portal. Saying which
                            ones are anonymous is how he notices. */}
                        {!inv.subcontractorId && (
                          <Text style={styles.inviteMeta} numberOfLines={1}>Not on your roster — bids back from here arrive unlinked</Text>
                        )}
                      </View>
                      <View style={[styles.invitePill, pillStyle]}>
                        <Text style={[styles.invitePillText, { color: pillInk }]}>{inv.localOnly ? 'Not uploaded' : inviteStateLabel(state)}</Text>
                      </View>
                      {/* A pending invite's link answers bid_invite_denied until
                          it uploads — no copy button to hand out a dead link. */}
                      {state !== 'responded' && !inv.localOnly && (
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
                style={[styles.inviteBtn, !scopeText && styles.inviteBtnBlocked]}
                onPress={() => { if (scopeText) setShowInvite(true); }}
                disabled={!scopeText}
                activeOpacity={0.85}
                testID="invite-subs-to-bid"
                accessibilityRole="button"
                accessibilityState={{ disabled: !scopeText }}
                accessibilityLabel={scopeText
                  ? 'Invite subs to bid'
                  : 'Invite subs to bid — unavailable until this package has a scope of work'}
              >
                <Mail size={15} color={scopeText ? themeColors.accent : themeColors.textMuted} strokeWidth={1.75} />
                <Text style={[styles.inviteBtnText, !scopeText && { color: themeColors.textMuted }]}>
                  {invites.length === 0 ? 'Invite subs to bid' : 'Invite more subs'}
                </Text>
                {scopeText && <ArrowRight size={14} color={themeColors.accent} strokeWidth={1.75} />}
              </TouchableOpacity>
              {/* A blocked button says why, and says what unblocks it. */}
              {!scopeText && (
                <Text style={styles.inviteBlockedWhy}>
                  No scope written yet. An invitation without one asks the sub to price a name and an address — and the bid page tells him to email you for the details, which is the phone call this replaces. Write the scope above and this turns on.
                </Text>
              )}

              {/* Chase. The banner used to tell him to do this and offer no way. */}
              {remindable.length > 0 && (
                <TouchableOpacity
                  style={[styles.remindBtn, reminding && { opacity: 0.6 }]}
                  onPress={() => { void handleRemind(); }}
                  disabled={reminding}
                  activeOpacity={0.85}
                  testID="invite-remind"
                >
                  {reminding ? (
                    <ActivityIndicator size="small" color={themeColors.text} />
                  ) : (
                    <Send size={14} color={themeColors.text} strokeWidth={1.75} />
                  )}
                  <Text style={styles.remindBtnText}>
                    {reminding
                      ? 'Sending…'
                      : `Re-send to the ${remindable.length} who ${remindable.length === 1 ? 'has' : 'have'}n't answered`}
                  </Text>
                </TouchableOpacity>
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
                const priced = bidAmountOf(bid) != null;
                const total = bid.amount + (bid.normalizedAdjustment ?? 0);
                const vsBudget = pkg.estimateBudget - total;
                const isWinner = winningBidId === bid.id;
                // Never a bid with no amount, and only when two PRICED bids compete.
                const isLowest = priced && i === 0 && pricedBids.length > 1;
                const outlier = isOutlier(bid);
                const filedBySub = invitedBidIds.has(bid.id);
                const isAwardedBid = bid.status === 'awarded' || pkg.awardedBidId === bid.id;
                // The sub's own number is his to change (call him); an awarded
                // bid's amount is the commitment's now.
                const canEditAmount = !filedBySub && !isAwardedBid;
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
                      <TouchableOpacity onPress={() => handleDeleteBid(bid, filedBySub)} hitSlop={10} style={styles.bidDelete} accessibilityRole="button" accessibilityLabel={`Delete ${bid.vendorName ?? 'this'} bid`} testID={`delete-bid-${bid.id}`}>
                        <Trash2 size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                      </TouchableOpacity>
                    </View>

                    <View style={styles.bidAmountsRow}>
                      <TouchableOpacity
                        style={styles.bidAmountCell}
                        onPress={() => { if (canEditAmount) { setAmountDraft(priced ? String(bid.amount) : ''); setAmountEditBidId(bid.id); } }}
                        disabled={!canEditAmount}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={canEditAmount ? `Edit the amount of ${bid.vendorName ?? 'this'} bid` : undefined}
                        testID={`bid-amount-${bid.id}`}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Text style={styles.bidAmountLabel}>Bid</Text>
                          {canEditAmount && <Pencil size={10} color={themeColors.textMuted} strokeWidth={2} />}
                        </View>
                        <Text style={[styles.bidAmountValue, !priced && { color: themeColors.danger }]}>
                          {priced ? formatMoney(bid.amount) : 'No amount'}
                        </Text>
                      </TouchableOpacity>
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
                        <Text style={[styles.bidAmountValueTotal, { color: !priced ? themeColors.textMuted : vsBudget >= 0 ? themeColors.success : themeColors.danger }]}>
                          {priced ? formatMoney(total) : '—'}
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

                    {pkg.status !== 'awarded' && (priced ? (
                      <TouchableOpacity style={styles.awardBtn} onPress={() => handleAward(bid)} activeOpacity={0.85}>
                        <Trophy size={14} color="#FFF" strokeWidth={1.75} />
                        <Text style={styles.awardBtnText}>Award · {formatMoney(total)}</Text>
                        <ArrowRight size={14} color="#FFF" strokeWidth={1.75} />
                      </TouchableOpacity>
                    ) : (
                      // No Award on a bid that can't be awarded — the reason
                      // and the fix instead (#95).
                      <TouchableOpacity
                        style={styles.needsAmountBtn}
                        onPress={() => { setAmountDraft(''); setAmountEditBidId(bid.id); }}
                        activeOpacity={0.85}
                        testID={`needs-amount-${bid.id}`}
                      >
                        <AlertTriangle size={14} color={themeColors.danger} strokeWidth={1.75} />
                        <Text style={[styles.needsAmountText, { color: themeColors.danger }]}>Needs an amount — tap to add it</Text>
                      </TouchableOpacity>
                    ))}
                    {/* Who this bid is actually FROM, as a record rather than a
                        name. Without the link the award creates a commitment
                        that names a company and references nobody: no
                        scorecard, no compliance check, and no sub portal
                        (app/sub-portals.tsx skips commitments with no
                        subcontractorId), so invoices and payment go back to
                        email and text. */}
                    {bid.subcontractorId ? (
                      <View style={styles.bidSubLink}>
                        <Text style={styles.bidSubLinkText} numberOfLines={2}>
                          {linkNotes[bid.id]
                            ?? `Linked to ${getSubcontractor(bid.subcontractorId)?.companyName ?? 'a sub on your roster'}.`}
                        </Text>
                        <TouchableOpacity
                          style={styles.subScorecardBtn}
                          onPress={() => router.push({ pathname: '/sub-scorecard', params: { subId: bid.subcontractorId } } as never)}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.subScorecardBtnText}>See this sub&apos;s scorecard →</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.bidLinkBtn}
                        onPress={() => setLinkTargetBidId(bid.id)}
                        activeOpacity={0.85}
                        testID={`link-bid-${bid.id}`}
                      >
                        <Link2 size={13} color={themeColors.accent} strokeWidth={1.75} />
                        <Text style={styles.bidLinkBtnText}>Link this bid to a sub</Text>
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
        <Modal visible={showAddBid} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setShowAddBid(false); setAddBidNote(null); }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: themeColors.bg }}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Log a bid</Text>
              <TouchableOpacity onPress={() => { setShowAddBid(false); setAddBidNote(null); }} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <X size={22} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              {!!addBidNote && (
                <View style={styles.warningCard} testID="add-bid-note">
                  <AlertTriangle size={14} color={Colors.warningLabel} strokeWidth={1.75} />
                  <Text style={[styles.warningBody, { flex: 1, marginTop: 0 }]}>{addBidNote}</Text>
                </View>
              )}
              <Text style={styles.fieldLabel}>Vendor *</Text>
              <TextInput style={styles.input} value={newVendor} onChangeText={setNewVendor} placeholder="e.g. Joe's Plumbing" placeholderTextColor={themeColors.textMuted} autoFocus />
              <Text style={styles.fieldLabel}>Amount *</Text>
              <TextInput style={styles.input} value={newAmount} onChangeText={setNewAmount} placeholder="Total dollar bid, e.g. 4,800.50" placeholderTextColor={themeColors.textMuted} keyboardType="decimal-pad" autoFocus={!!addBidNote && !!newVendor} testID="add-bid-amount" />
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

        {/* Fix a bid's amount (#95) — the card's only edit. The sub's own
            number is not editable here; a GC-keyed or voice bid is. */}
        <Modal visible={!!amountEditBidId} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAmountEditBidId(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: themeColors.bg }}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>
                {`Amount · ${bids.find(b => b.id === amountEditBidId)?.vendorName ?? 'this bid'}`}
              </Text>
              <TouchableOpacity onPress={() => setAmountEditBidId(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <X size={22} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text style={styles.fieldLabel}>Bid total *</Text>
              <TextInput
                style={styles.input}
                value={amountDraft}
                onChangeText={setAmountDraft}
                placeholder="e.g. 4,800.50"
                placeholderTextColor={themeColors.textMuted}
                keyboardType="decimal-pad"
                autoFocus
                testID="bid-amount-input"
              />
            </ScrollView>
            <View style={[styles.modalFoot, { paddingBottom: insets.bottom + 12 }]}>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveAmount} activeOpacity={0.85} testID="bid-amount-save">
                <Save size={16} color="#FFF" strokeWidth={1.75} />
                <Text style={styles.saveBtnText}>Save amount</Text>
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

              {/* The roster, which this sheet could not see. Picking a sub here
                  is what carries his id onto the invite row, the bid the RPC
                  files from it, and the commitment the award creates — the
                  join the scorecard, the compliance check and the sub portal
                  all need and none of them ever had. */}
              {roster.length > 0 && (
                <>
                  <View style={styles.rosterHead}>
                    <Users size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                    <Text style={styles.fieldLabel}>Your subs{pkg.phase || pkg.name ? ` · ${(pkg.phase || pkg.name).toLowerCase()} first` : ''}</Text>
                  </View>
                  <View style={styles.rosterList}>
                    {roster.map(s => {
                      const picked = pickedSubIds.includes(s.id);
                      const hasEmail = !!s.email.trim();
                      const status = getComplianceStatus(s, Date.now());
                      const tone = status === 'compliant' ? themeColors.success
                        : status === 'expired' ? themeColors.danger
                          : Colors.warningLabel;
                      const isMatch = normalizeTradeKey(s.trade) === tradeKey;
                      return (
                        <TouchableOpacity
                          key={s.id}
                          style={[styles.rosterRow, picked && styles.rosterRowPicked, !hasEmail && { opacity: 0.6 }]}
                          onPress={() => {
                            if (!hasEmail) return;
                            setPickedSubIds(prev => prev.includes(s.id) ? prev.filter(id => id !== s.id) : [...prev, s.id]);
                          }}
                          disabled={!hasEmail}
                          activeOpacity={0.85}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: picked, disabled: !hasEmail }}
                          accessibilityLabel={hasEmail
                            ? `${s.companyName}, ${s.trade}, ${complianceLabel(status, s)}`
                            : `${s.companyName} — no email address on file, so they cannot be invited`}
                          testID={`invite-roster-${s.id}`}
                        >
                          <View style={[styles.rosterCheck, picked && styles.rosterCheckOn]}>
                            {picked && <CheckCircle2 size={14} color={Colors.textOnAccent} strokeWidth={2.5} />}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.rosterName} numberOfLines={1}>{s.companyName}</Text>
                            <Text style={styles.rosterMeta} numberOfLines={1}>
                              {/* Never a guess: no email is the reason he cannot
                                  be invited, said out loud rather than a row
                                  that silently does nothing when tapped. */}
                              {hasEmail ? s.email : 'No email on file — add one on the Subs tab to invite them'}
                            </Text>
                            {(isMatch || packageMatch?.subId === s.id) && (
                              <Text style={styles.rosterMatch} numberOfLines={1}>
                                {packageMatch?.subId === s.id ? packageMatch.reason : `Does ${s.trade.toLowerCase()}`}
                              </Text>
                            )}
                          </View>
                          <View style={[styles.rosterChip, { borderColor: tone + '55', backgroundColor: tone + '1A' }]}>
                            <Text style={[styles.rosterChipText, { color: tone }]}>{complianceLabel(status, s)}</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              <Text style={styles.fieldLabel}>{roster.length > 0 ? 'Anyone else — by email' : 'Sub email addresses *'}</Text>
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
              <Text style={styles.inviteHint}>One per line, or separated by commas — a pasted &quot;Joe Smith &lt;joe@ace.com&gt;&quot; works too. An address that matches a sub on your roster is linked to them automatically. Each link lands in the list on this screen as well, so if the email can&apos;t go out you can copy it and text it over. Links stop working after 30 days — the same window material pricing holds for.</Text>
              {/* What the sub is actually told, stated plainly: the email's
                  "Bids due" row and the bid page's banner (#99) both read
                  this package's date. */}
              {!!pkg.dueDate && (
                <Text style={styles.inviteHint}>
                  Bids due {formatCalendarDay(pkg.dueDate, { weekday: 'long', month: 'short', day: 'numeric' })} — their email and the bid page both show this date. Chase from this screen if it gets close.
                </Text>
              )}
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

        {/* Scope editor. The generated text is a seed, not a lock — a GC who
            wants to add "coordinate with the ceiling grid before rough-in"
            types it here and the sub reads it on the bid page. */}
        <Modal visible={showScopeEdit} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowScopeEdit(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: themeColors.bg }}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Scope of work</Text>
              <TouchableOpacity onPress={() => setShowScopeEdit(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <X size={22} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text style={styles.inviteExplain}>
                This is the only description of the work the sub ever sees — it goes in his email and on the page where he types his price. Quantities and units, not your carry.
              </Text>
              <TextInput
                style={[styles.input, styles.scopeInput]}
                value={scopeDraft}
                onChangeText={setScopeDraft}
                placeholder={'e.g.\n• 3/4" PEX supply — 420 LF\n• Fixture rough-in — 11 EA'}
                placeholderTextColor={themeColors.textMuted}
                multiline
                testID="scope-input"
              />
              {canGenerateScope(packageItems) && (
                <TouchableOpacity
                  style={styles.scopeEditBtn}
                  onPress={() => setScopeDraft(estimateItemsToScope(packageItems))}
                  activeOpacity={0.85}
                >
                  <FileText size={14} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.scopeEditText}>Re-write it from the {packageItems.length} linked estimate line{packageItems.length === 1 ? '' : 's'}</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
            <View style={[styles.modalFoot, { paddingBottom: insets.bottom + 12 }]}>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveScope} activeOpacity={0.85} testID="scope-save">
                <Save size={16} color="#FFF" strokeWidth={1.75} />
                <Text style={styles.saveBtnText}>Save scope</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Link an anonymous bid back to the roster. This is the control the
            award dialog points at: until the bid carries a subcontractorId the
            commitment it creates cannot be given a sub portal and teaches the
            scorecard nothing. */}
        <Modal visible={!!linkTargetBidId} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLinkTargetBidId(null)}>
          <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Who sent this bid?</Text>
              <TouchableOpacity onPress={() => setLinkTargetBidId(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <X size={22} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text style={styles.inviteExplain}>
                {roster.length > 0
                  ? 'Pick the sub this bid came from. It links the award to his record, so the commitment can carry a sub portal, the compliance check has something to check, and the scorecard learns from the job.'
                  : 'Nobody is on your roster for this job yet. Add the sub on the Subs tab — with their email, licence and COI dates — and this bid can be linked to them.'}
              </Text>
              <View style={styles.rosterList}>
                {roster.map(s => {
                  const status = getComplianceStatus(s, Date.now());
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={styles.rosterRow}
                      onPress={() => {
                        if (!linkTargetBidId) return;
                        updateBidPackageBid(linkTargetBidId, { subcontractorId: s.id });
                        setLinkNotes(prev => ({ ...prev, [linkTargetBidId]: `Linked to ${s.companyName} — you picked them for this bid.` }));
                        // Never auto-overwrite a link the GC made by hand.
                        autoLinkedRef.current.add(linkTargetBidId);
                        setLinkTargetBidId(null);
                        if (Platform.OS !== 'web') void Haptics.selectionAsync();
                      }}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={`Link this bid to ${s.companyName}`}
                      testID={`link-to-${s.id}`}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rosterName} numberOfLines={1}>{s.companyName}</Text>
                        <Text style={styles.rosterMeta} numberOfLines={1}>{s.trade}{s.email ? ` · ${s.email}` : ''}</Text>
                      </View>
                      <Text style={styles.rosterMeta}>{complianceLabel(status, s)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                style={styles.scopeEditBtn}
                onPress={() => { setLinkTargetBidId(null); router.push('/(tabs)/subs' as never); }}
                activeOpacity={0.85}
              >
                <Users size={14} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.scopeEditText}>Add a sub on the Subs tab</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
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
  inviteBtnBlocked: { borderColor: t.line, backgroundColor: t.surfaceAlt },
  inviteBlockedWhy: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 8 },
  remindBtn: {
    ...cardSurface(t, { radius: 'lg', pad: 'none' }),
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    marginTop: 8, paddingVertical: 11,
  },
  remindBtnText: { color: t.text, fontSize: Type.footnote.fontSize, fontWeight: '700' as const },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  dueRowText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' as const },

  scopeCard: { ...cardSurface(t, { radius: 'lg', pad: 'none' }), padding: 14, gap: 10 },
  scopeText: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 20 },
  scopeEmptyText: { fontSize: Type.footnote.fontSize, color: t.textMuted, lineHeight: 19 },
  scopeInput: { minHeight: 220, textAlignVertical: 'top' as const, lineHeight: 20 },
  scopeBtnRow: { gap: 8 },
  scopeGenBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: t.accentFill, paddingVertical: 11, borderRadius: Tokens.radius.card },
  scopeGenText: { color: Colors.textOnAccent, fontSize: Type.footnote.fontSize, fontWeight: '700' as const },
  scopeEditBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginTop: 8 },
  scopeEditText: { color: t.accent, fontSize: Type.footnote.fontSize, fontWeight: '700' as const },

  rosterHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rosterList: { gap: 6, marginTop: 4 },
  rosterRow: { ...cardSurface(t, { radius: 'md', pad: 12 }), flexDirection: 'row', alignItems: 'center', gap: 10 },
  rosterRowPicked: { backgroundColor: t.accent + '0F', borderColor: t.accent + '60' },
  rosterCheck: { width: 22, height: 22, borderRadius: Tokens.radius.xs, borderWidth: 2, borderColor: t.line, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  rosterCheckOn: { backgroundColor: t.accent, borderColor: t.accent },
  rosterName: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  rosterMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2 },
  rosterMatch: { fontSize: Type.caption2.fontSize, color: t.accent, marginTop: 2, fontWeight: '600' as const },
  rosterChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.full, borderWidth: 1 },
  rosterChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, letterSpacing: 0.3 },

  bidSubLink: { gap: 2, paddingTop: 6 },
  bidSubLinkText: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17 },
  bidLinkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4, paddingVertical: 10, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.accent + '40', backgroundColor: t.accent + '0F' },
  bidLinkBtnText: { color: t.accent, fontSize: Type.caption1.fontSize, fontWeight: '700' as const },
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

  needsAmountBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.danger + '55', backgroundColor: t.danger + '0F' },
  needsAmountText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const },
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
