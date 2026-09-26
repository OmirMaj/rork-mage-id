// app/prequal-manager.tsx — GC-side prequalification & COI manager.
//
// Single-screen control center: lists every sub with their prequal status,
// renewal cadence, and auto-review findings. The GC can:
//   • Invite a sub (generates magic link, opens email composer)
//   • Review a submitted packet (run auto-review → approve / needs-changes)
//   • Renew an approved packet when it's in the 60/30/7-day window
//   • Override an auto-review decision with a reviewer note
//
// Sub side is `app/prequal-form.tsx` — reached via the emailed magic link,
// no auth. See that file for the data-entry UI.

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Modal, TextInput, RefreshControl,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
// The invite is opened on the SUB's device — an office PC, Outlook, a phone
// without MAGE ID — so it is an https link on the host that serves the Expo
// route (prequal-form is public and loads the packet anonymously by token),
// never mageid://, which only opens where the binary is installed. Built on
// shareLinkBase so it can never land on the marketing host, whose catch-all
// 404s every Expo route. Guarded by scripts/validate-share-link-host.ts.
import { shareLinkBase } from '@/utils/webAppOrigin';
import {
  ShieldCheck, ShieldAlert, ShieldX, Clock, Send, ChevronRight,
  ChevronLeft, X, CheckCircle2, AlertTriangle, Copy, Scale, RefreshCw, Mail,
} from 'lucide-react-native';
import { RevenueEarlyAccessCard } from '@/components/RevenueEarlyAccessCard';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { generateUUID } from '@/utils/generateId';
import { copyToClipboard } from '@/utils/clipboard';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import {
  reviewPrequalPacket, computePrequalExpiry, prequalApprovalRisk, renewalBucket,
  type PrequalReviewResult,
} from '@/utils/prequalEngine';
// Q5: the magic-link token comes from expo-crypto's CSPRNG, not Math.random.
import { generatePrequalToken } from '@/utils/prequalToken';
import { composeMailOrOfferLink } from '@/utils/prequalMail';
import {
  DEFAULT_PREQUAL_CRITERIA,
  type PrequalPacket,
  type PrequalStatus,
  type Subcontractor,
} from '@/types';
import { StatusPipeline } from '@/components/StatusPipeline';
import { stagesFor, visualStageFor, isSideBranch } from '@/utils/workflowPipelines';
import { useSheetFrame, useSheetPrimaryHotkey } from '@/components/ui';

/** Q5: sign the emails the GC sends with HIS company — they used to end
 *  "Thanks, MAGE ID", which reads as a vendor mailing the sub, not the GC. */
function prequalSignOff(companyName: string | undefined): string {
  const name = (companyName ?? '').trim();
  return name ? `Thanks,\n${name}` : 'Thanks';
}

/** Recipient-safe prequal invite URL. Independent of the SENDER's platform:
 *  the GC on his iPhone and on the laptop mint the same https link. */
function prequalInviteUrl(token: string): string {
  const runtimeOrigin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : null;
  return `${shareLinkBase(runtimeOrigin)}/prequal-form?token=${encodeURIComponent(token)}`;
}

// ── pure: review + renewal (run by scripts/validate-w5-lien-prequal-screens.ts) ──
// Self-contained on purpose — type imports only — so the validator can
// transpile and EXECUTE this block rather than grep it.

/**
 * A prequal_packets row → PrequalPacket. A third copy of the mapper (the
 * others: ProjectContext's loader, prequal-form's RPC reader), kept here
 * because the review modal re-reads ONE packet by id before the GC decides
 * (#24) and ProjectContext exposes no single-packet read.
 */
function rowToPrequalPacket(r: Record<string, unknown>): PrequalPacket {
  return {
    id: r.id as string,
    subcontractorId: r.subcontractor_id as string,
    projectId: (r.project_id as string | null) ?? undefined,
    status: r.status as PrequalPacket['status'],
    criteria: (r.criteria as PrequalPacket['criteria']) ?? {} as PrequalPacket['criteria'],
    financials: (r.financials as PrequalPacket['financials']) ?? {} as PrequalPacket['financials'],
    safety: (r.safety as PrequalPacket['safety']) ?? {} as PrequalPacket['safety'],
    insurance: (r.insurance as PrequalPacket['insurance']) ?? {} as PrequalPacket['insurance'],
    licenses: (r.licenses as PrequalPacket['licenses']) ?? [],
    w9OnFile: !!r.w9_on_file,
    w9DocPath: (r.w9_doc_path as string | null) ?? undefined,
    inviteToken: (r.invite_token as string | null) ?? undefined,
    inviteSentAt: (r.invite_sent_at as string | null) ?? undefined,
    inviteEmail: (r.invite_email as string | null) ?? undefined,
    submittedAt: (r.submitted_at as string | null) ?? undefined,
    reviewedAt: (r.reviewed_at as string | null) ?? undefined,
    reviewedBy: (r.reviewed_by as string | null) ?? undefined,
    autoReviewFindings: (r.auto_review_findings as PrequalPacket['autoReviewFindings']) ?? undefined,
    reviewerNotes: (r.reviewer_notes as string | null) ?? undefined,
    expiresAt: (r.expires_at as string | null) ?? undefined,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/** The review fields a decision may change. Everything else on the packet is
 *  the sub's (financials, safety, insurance, licenses, W-9, submitted_at) or the
 *  GC's standing criteria, and a decision must never rewrite them (#24). */
type PrequalReviewPatch = Pick<PrequalPacket, 'status' | 'updatedAt'> & Partial<{
  reviewerNotes: PrequalPacket['reviewerNotes'];
  reviewedAt: PrequalPacket['reviewedAt'];
  reviewedBy: PrequalPacket['reviewedBy'];
  expiresAt: PrequalPacket['expiresAt'];
  autoReviewFindings: PrequalPacket['autoReviewFindings'];
}>;

/**
 * The packet a decision writes: the FRESH server copy with only the review
 * fields laid over it. The old code spread the GC's in-memory copy — read
 * before the sub submitted — and so wrote `financials: {}` and friends over the
 * sub's answers. The merged packet is what this screen shows and emails; the
 * SERVER write is the context's narrow reviewPrequalPacket (review columns
 * only, via prequalReviewPatchOf), so no copy of the sub's answers is sent.
 */
function applyPrequalReview(fresh: PrequalPacket, patch: PrequalReviewPatch): PrequalPacket {
  // The patch type admits review fields only, so the spread can reach nothing
  // the sub wrote; a field the patch does not name stays as the server has it.
  return { ...fresh, ...patch };
}

/** The review columns of a decided packet — exactly what the context's narrow
 *  write (reviewPrequalPacket) sends. `reviewedBy` rides along only when set. */
function prequalReviewPatchOf(p: PrequalPacket): PrequalReviewPatch {
  const all: PrequalReviewPatch = {
    status: p.status,
    updatedAt: p.updatedAt,
    reviewerNotes: p.reviewerNotes,
    reviewedAt: p.reviewedAt,
    reviewedBy: p.reviewedBy,
    expiresAt: p.expiresAt,
    autoReviewFindings: p.autoReviewFindings,
  };
  // Only the keys that are set: an absent key is left as the server has it.
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined)) as PrequalReviewPatch;
}

/** Which packets can be sent a renewal (#32): a decided or lapsed packet, or
 *  one inside its renewal window. Never one whose link the sub may be filling
 *  in right now (invited / draft / in_progress) — a new token kills that link.
 *  `bucket` is renewalBucket(expiresAt), or null with no expiry. */
function canSendPrequalRenewal(
  status: PrequalPacket['status'],
  bucket: '60d' | '30d' | '7d' | 'expired' | 'ok' | null,
): boolean {
  if (status === 'invited' || status === 'draft' || status === 'in_progress') return false;
  if (status === 'approved' || status === 'expired' || status === 'rejected' || status === 'needs_changes') return true;
  return bucket === '60d' || bucket === '30d' || bucket === '7d' || bucket === 'expired';
}

/**
 * The renewal write (#32). A NEW token (the old link stops working), status
 * back to 'invited', and the old decision cleared: expiresAt (else
 * lookup_prequal_packet_by_token still refuses the new link as expired),
 * submittedAt (else submit_prequal_packet keeps last year's date), reviewedAt,
 * reviewer notes and findings. The sub's answers and the GC's criteria stay as
 * the starting point, so renewing is editing last year's packet, not retyping it.
 */
function buildPrequalRenewal(existing: PrequalPacket, token: string, email: string, nowIso: string): PrequalPacket {
  return {
    ...existing,
    status: 'invited',
    inviteToken: token,
    inviteSentAt: nowIso,
    inviteEmail: email,
    expiresAt: undefined,
    submittedAt: undefined,
    reviewedAt: undefined,
    reviewerNotes: undefined,
    autoReviewFindings: undefined,
    updatedAt: nowIso,
  };
}
// ── end pure ──

/**
 * Sentence-case labels for the three OFF-PATH prequal states, for the
 * side-branch badge in the review modal. StatusBadge's labels are LIST labels
 * ("CHANGES" inside an 82px pill); this badge is a sentence, so "Needs changes"
 * rather than "Changes".
 */
const PREQUAL_SIDE_BRANCH_LABEL: Record<string, string> = {
  needs_changes: 'Needs changes',
  rejected: 'Rejected',
  expired: 'Expired',
};

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Render a stored packet date for humans. THE ONLY way a date on this screen
 * may reach a <Text>.
 *
 * Packet dates arrive in two shapes and both are load-bearing:
 *   • date-only `YYYY-MM-DD` — what `computePrequalExpiry` writes (it ends in
 *     `.toISOString().slice(0, 10)`) and what the sub types into prequal-form.
 *   • a full ISO timestamp — what ProjectContext reads back out of Supabase's
 *     `expires_at` timestamptz column.
 * The sub list interpolated the stored string straight into the row, so a
 * packet that had round-tripped through the backend rendered
 * "· Renews 2026-12-14T22:57:36.841Z".
 *
 * Date-only strings are parsed as UTC midnight by `new Date`, so formatting
 * them in any negative-offset zone (i.e. every US jobsite) would print the
 * PREVIOUS day. Those are pinned to UTC; real timestamps name an instant and
 * are formatted local. Unparseable input returns null so the caller decides
 * between hiding the fragment and showing the raw value.
 */
function formatPacketDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const dateOnly = DATE_ONLY_RE.test(value);
  const d = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(dateOnly ? { timeZone: 'UTC' } : {}),
  });
}

// ─────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────

export default function PrequalManagerScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('prequal_coi')) {
    return <Paywall visible feature="Prequal + COI Tracking" requiredTier="pro" onClose={() => router.back()} />;
  }
  return <PrequalManagerInner />;
}

function PrequalManagerInner() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  // The context's narrow review write (#24, w5-join-core) — aliased: this file
  // already imports prequalEngine's reviewPrequalPacket (the auto-review).
  const { subcontractors, upsertPrequalPacket, reviewPrequalPacket: writePrequalReview, getPrequalPacketForSub, prequalPackets, settings } = useProjects();
  const signOff = prequalSignOff(settings?.branding?.companyName);
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [reviewingPacket, setReviewingPacketState] = useState<PrequalPacket | null>(null);
  const [invitingSub, setInvitingSub] = useState<Subcontractor | null>(null);
  // #32: the renewal sheet — the same email sheet as an invite, for a packet
  // that already exists.
  const [renewing, setRenewing] = useState<{ packet: PrequalPacket; sub: Subcontractor | null } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * #24 — the review modal decides on the packet AS THE SERVER HAS IT, not on
   * this phone's copy. The list is read once per context mount and nothing
   * tells it when a sub submits through the anonymous RPC, so a GC who opened
   * a packet still showing "Invited" saw every field empty, tapped Needs
   * changes, and the full-row write blanked the sub's whole submission.
   *
   *  'checking' — the re-read is in flight; every decision is disabled.
   *  'fresh'    — decisions act on the row just read.
   *  'cached'   — the re-read failed (offline); decisions are allowed on the
   *               cached copy, which the modal labels as possibly out of date.
   */
  const [freshness, setFreshness] = useState<{ state: 'checking' | 'fresh' | 'cached'; readAt?: number } | null>(null);
  const reviewSeq = useRef(0);
  const setReviewingPacket = useCallback((packet: PrequalPacket | null) => {
    const seq = ++reviewSeq.current;
    setReviewingPacketState(packet);
    if (!packet) { setFreshness(null); return; }
    setFreshness({ state: 'checking' });
    void (async () => {
      try {
        const { data, error } = await supabase.from('prequal_packets').select('*').eq('id', packet.id).maybeSingle();
        if (seq !== reviewSeq.current) return;
        if (error) throw error;
        if (!data) {
          // Not on the server (deleted elsewhere, or a local-only packet that
          // never synced). The cached copy is all there is — say so.
          setFreshness({ state: 'cached', readAt: queryClient.getQueryState(['prequalPackets', user?.id])?.dataUpdatedAt });
          return;
        }
        setReviewingPacketState(rowToPrequalPacket(data as Record<string, unknown>));
        setFreshness({ state: 'fresh' });
      } catch {
        if (seq !== reviewSeq.current) return;
        setFreshness({ state: 'cached', readAt: queryClient.getQueryState(['prequalPackets', user?.id])?.dataUpdatedAt });
      }
    })();
  }, [queryClient, user?.id]);

  // Keep the list honest about submissions (#24/#111): re-read on focus and on
  // pull. The context's foreground refetch is w5-join-core's; this is the
  // screen's own, through the same query key, so the context state follows.
  const refetchPackets = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['prequalPackets', user?.id] });
  }, [queryClient, user?.id]);
  const focusedOnce = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!focusedOnce.current) { focusedOnce.current = true; return; }
    void refetchPackets();
  }, [refetchPackets]));
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refetchPackets(); } finally { setRefreshing(false); }
  }, [refetchPackets]);

  // `inviteSubId` — the award dialog in app/buyout-package.tsx offers "Request
  // prequal" for a sub with no packet, so the answer to that note is one tap
  // rather than finding him in this list. Opens the invite sheet once, when
  // the roster has loaded; a packet that already exists is opened for review
  // instead, because re-inviting would mint a new token and kill the link the
  // sub may already be filling in.
  const { inviteSubId } = useLocalSearchParams<{ inviteSubId?: string }>();
  const handledInviteParam = useRef(false);
  useEffect(() => {
    if (!inviteSubId || handledInviteParam.current) return;
    const target = subcontractors.find(s => s.id === inviteSubId);
    if (!target) return;
    handledInviteParam.current = true;
    const existing = getPrequalPacketForSub(target.id);
    // #32: an expired or approved packet is what "Request prequal" from the
    // award dialog is really asking to renew; anything still in flight opens
    // for review, where the live link is kept.
    const lapsed = existing && (existing.status === 'expired'
      || (existing.status === 'approved' && !!existing.expiresAt && renewalBucket(existing.expiresAt) === 'expired'));
    if (existing && (lapsed || existing.status === 'approved')) setRenewing({ packet: existing, sub: target });
    else if (existing) setReviewingPacket(existing);
    else setInvitingSub(target);
  }, [inviteSubId, subcontractors, getPrequalPacketForSub, setReviewingPacket]);

  // `packetId` — the 'prequal_submitted' notification (CONTRACT 8) opens the
  // packet the sub just submitted. Once, when the list has it; the review
  // re-reads the row by id, so a list read before the submit is fine.
  const { packetId } = useLocalSearchParams<{ packetId?: string }>();
  const handledPacketParam = useRef(false);
  useEffect(() => {
    if (!packetId || handledPacketParam.current) return;
    const target = prequalPackets.find(p => p.id === packetId);
    if (!target) return;
    handledPacketParam.current = true;
    setReviewingPacket(target);
  }, [packetId, prequalPackets, setReviewingPacket]);

  // Build a row per sub with packet+status+review info.
  const rows = useMemo(() => {
    return subcontractors.map(sub => {
      const packet = getPrequalPacketForSub(sub.id);
      const review = packet && packet.status !== 'draft' && packet.status !== 'invited'
        ? reviewPrequalPacket(packet)
        : null;
      const bucket = packet?.expiresAt ? renewalBucket(packet.expiresAt) : null;
      // Formatted ONCE here, not in the row body — see formatPacketDate.
      const renewsOn = formatPacketDate(packet?.expiresAt);
      return { sub, packet, review, bucket, renewsOn };
    });
    // `getPrequalPacketForSub` is rebuilt in the context whenever packets change,
    // so it carries the packet list's identity — no need to list prequalPackets.
  }, [subcontractors, getPrequalPacketForSub]);

  const counts = useMemo(() => {
    const out = { approved: 0, pending: 0, issues: 0, none: 0 };
    for (const r of rows) {
      if (!r.packet) out.none++;
      else if (r.packet.status === 'approved') out.approved++;
      else if (r.packet.status === 'submitted' || r.packet.status === 'in_progress') out.pending++;
      else if (r.packet.status === 'rejected' || r.packet.status === 'needs_changes' || r.packet.status === 'expired') out.issues++;
      else if (r.packet.status === 'invited' || r.packet.status === 'draft') out.pending++;
    }
    return out;
  }, [rows]);

  const handleInvite = useCallback((sub: Subcontractor, email: string) => {
    const now = new Date().toISOString();
    const existing = getPrequalPacketForSub(sub.id);
    const token = generatePrequalToken();
    const packet: PrequalPacket = existing
      ? { ...existing, status: 'invited', inviteToken: token, inviteSentAt: now, inviteEmail: email, updatedAt: now }
      : {
          id: generateUUID(),
          subcontractorId: sub.id,
          status: 'invited',
          criteria: DEFAULT_PREQUAL_CRITERIA,
          financials: {},
          safety: {},
          insurance: {},
          licenses: [],
          w9OnFile: false,
          inviteToken: token,
          inviteSentAt: now,
          inviteEmail: email,
          createdAt: now,
          updatedAt: now,
        };
    upsertPrequalPacket(packet);

    // Compose email.
    const link = prequalInviteUrl(token);
    const subject = encodeURIComponent(`Prequalification for ${sub.companyName}`);
    const body = encodeURIComponent(
      `Hi ${sub.contactName || 'there'},\n\n` +
      `Please complete our subcontractor prequalification form. This keeps your paperwork current and unlocks bid invites from us — it takes about 10 minutes and you don't need a login.\n\n` +
      `Start here: ${link}\n\n` +
      `If the link doesn't open, tell us your preferred email and we'll resend.\n\n` +
      signOff
    );
    // Q5: same honesty as the renewal and decision emails. This used to
    // swallow a failed open, so with no mail app the GC saw nothing and had no
    // link — the packet was saved and nobody was told.
    void composeMailOrOfferLink({
      mailto: `mailto:${email}?subject=${subject}&body=${body}`,
      link,
      ready: {
        title: 'Invite ready to send',
        nativeBody: `Your mail app opened with the link to ${email}. It is not sent until you tap Send there.`,
        webBody: `Your mail app should open with the link to ${email}. Nothing is sent until you tap Send there. If no mail app opened, copy the link and send it yourself — a text message works.`,
      },
      failed: {
        title: 'Invite saved — no email went out',
        body: `No mail app opened, so ${email} has not been sent anything. Copy the link and send it yourself — a text message works.`,
      },
    });
  }, [getPrequalPacketForSub, upsertPrequalPacket, signOff]);

  /**
   * #111 — tell the sub. A decision used to change a status the sub never saw:
   * no email, and the form never showed the note. The mail app opens with the
   * note and the sub's own link; nothing is sent until the GC taps Send there,
   * and the confirmation below says exactly that.
   */
  const emailDecision = useCallback(async (packet: PrequalPacket, kind: 'needs_changes' | 'rejected', note: string) => {
    const sub = subcontractors.find(s => s.id === packet.subcontractorId) ?? null;
    const to = (packet.inviteEmail ?? sub?.email ?? '').trim();
    const link = packet.inviteToken ? prequalInviteUrl(packet.inviteToken) : null;
    const what = kind === 'needs_changes' ? 'needs changes' : 'was not approved';
    if (!to || !link) {
      showAlert(
        'Saved — but the sub has not been told',
        !to
          ? `The packet is marked "${what}", but there is no email on it. Tell ${sub?.companyName ?? 'the sub'} yourself, or send a renewal with their address.`
          : `The packet is marked "${what}", but it has no link to send. Send a renewal to give the sub a working link.`,
      );
      return;
    }
    const subject = encodeURIComponent(kind === 'needs_changes'
      ? `Prequalification — changes needed${sub ? ` (${sub.companyName})` : ''}`
      : `Prequalification — not approved${sub ? ` (${sub.companyName})` : ''}`);
    const body = encodeURIComponent(
      `Hi ${sub?.contactName || 'there'},\n\n`
      + (kind === 'needs_changes'
        ? 'We reviewed your prequalification packet and need a few changes before we can approve it:\n\n'
        : 'We reviewed your prequalification packet and are not able to approve it at this time:\n\n')
      + `${note}\n\n`
      + (kind === 'needs_changes'
        ? `Update your answers and resubmit here — no login needed: ${link}\n\n`
        : `Your packet and this note are here: ${link}\n\n`)
      + signOff,
    );
    await composeMailOrOfferLink({
      mailto: `mailto:${to}?subject=${subject}&body=${body}`,
      link,
      ready: {
        title: 'Status saved — email ready to send',
        nativeBody: `Your mail app opened with the note to ${to}. It is not sent until you tap Send there. The sub also sees the note when they open their link.`,
        webBody: `Your mail app should open with the note to ${to}. Nothing is sent until you tap Send there. If no mail app opened, copy the link and send it with your note. The sub also sees the note when they open their link.`,
      },
      failed: {
        title: 'Status saved — no email went out',
        body: `No mail app opened, so ${to} has not been told. Copy the link and send it with your note, or use Resend note from this packet.`,
      },
    });
  }, [subcontractors, signOff]);

  // #24: each decision is the FRESH packet (the modal re-read it) with only the
  // review fields laid over it — never the stale in-memory spread.
  const handleApprove = useCallback((packet: PrequalPacket) => {
    const commit = () => {
      const now = new Date().toISOString();
      // expiresAt and the findings snapshot come from what the sub actually
      // submitted — the stale copy's coiExpiry was usually empty.
      const updated = applyPrequalReview(packet, {
        status: 'approved',
        reviewedAt: now,
        expiresAt: computePrequalExpiry(now, packet.insurance?.coiExpiry),
        autoReviewFindings: reviewPrequalPacket(packet).findings.map(f => ({
          criterion: f.criterion, passed: f.passed, note: f.note,
        })),
        updatedAt: now,
      });
      // #24: only the reviewer's columns go to the server — never the sub's
      // answers, which a row upsert would rewrite from whatever copy we hold.
      writePrequalReview(packet.id, prequalReviewPatchOf(updated));
      setReviewingPacket(null);
    };
    // Q5: an unreadable or past COI date caps the approval at today (see
    // computePrequalExpiry). Say so before writing it, not after.
    const { coiExpiry: typedCoi } = packet.insurance ?? {};
    const risk = prequalApprovalRisk(new Date().toISOString(), typedCoi);
    if (!risk) { commit(); return; }
    const warning = risk.kind === 'unreadable'
      ? `The COI expiry the sub entered ("${risk.typed}") is not a date MAGE can read, so this approval would only last until today. Send it back for changes to get a real date.`
      : `The sub's COI expiry (${formatPacketDate(risk.coi) ?? risk.coi}) is ${risk.today ? 'today' : 'already past'}, so this approval would lapse right away. Ask for a current certificate first.`;
    showAlert('Approve with this COI date?', warning, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve anyway', onPress: commit },
    ]);
  }, [writePrequalReview, setReviewingPacket]);

  const handleNeedsChanges = useCallback((packet: PrequalPacket, note: string) => {
    const now = new Date().toISOString();
    const updated = applyPrequalReview(packet, { status: 'needs_changes', reviewerNotes: note, reviewedAt: now, updatedAt: now });
    writePrequalReview(packet.id, prequalReviewPatchOf(updated));
    setReviewingPacket(null);
    void emailDecision(updated, 'needs_changes', note);
  }, [writePrequalReview, setReviewingPacket, emailDecision]);

  const handleReject = useCallback((packet: PrequalPacket, note: string) => {
    const now = new Date().toISOString();
    const updated = applyPrequalReview(packet, { status: 'rejected', reviewerNotes: note, reviewedAt: now, updatedAt: now });
    writePrequalReview(packet.id, prequalReviewPatchOf(updated));
    setReviewingPacket(null);
    void emailDecision(updated, 'rejected', note);
  }, [writePrequalReview, setReviewingPacket, emailDecision]);

  /** Resend the decision note (#111) — for a mail composer that was dismissed. */
  const handleResendNote = useCallback((packet: PrequalPacket) => {
    if (packet.status !== 'needs_changes' && packet.status !== 'rejected') return;
    void emailDecision(packet, packet.status, packet.reviewerNotes || (packet.status === 'rejected' ? 'Rejected by reviewer' : 'Please provide missing fields'));
  }, [emailDecision]);

  /**
   * #32 — renew an existing packet. Confirmed first, because both effects are
   * real: the old link stops working (a sub mid-form loses it) and an approved
   * packet leaves 'approved', which gates buyout, until the sub resubmits.
   */
  const handleRenew = useCallback((packet: PrequalPacket, sub: Subcontractor | null, email: string) => {
    const name = sub?.companyName ?? 'this sub';
    showAlert(
      'Send a renewal?',
      `The old link stops working${packet.status === 'approved' ? `, and ${name} leaves "approved" until they resubmit` : ''}. Their previous answers are kept as the starting point.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send renewal',
          onPress: () => {
            const now = new Date().toISOString();
            const token = generatePrequalToken();
            upsertPrequalPacket(buildPrequalRenewal(packet, token, email, now));
            setRenewing(null);
            setReviewingPacket(null);
            const link = prequalInviteUrl(token);
            const subject = encodeURIComponent(`Prequalification renewal for ${name}`);
            const body = encodeURIComponent(
              `Hi ${sub?.contactName || 'there'},\n\n`
              + 'It is time to renew your subcontractor prequalification with us. Your previous answers are already filled in — '
              + 'update anything that changed (insurance dates especially) and resubmit. No login needed.\n\n'
              + `Start here: ${link}\n\n`
              + `The link in any earlier email no longer works.\n\n${signOff}`,
            );
            void composeMailOrOfferLink({
              mailto: `mailto:${email}?subject=${subject}&body=${body}`,
              link,
              ready: {
                title: 'Renewal ready to send',
                nativeBody: `Your mail app opened with the new link to ${email}. It is not sent until you tap Send there.`,
                webBody: `Your mail app should open with the new link to ${email}. Nothing is sent until you tap Send there. If no mail app opened, copy the new link and send it yourself.`,
              },
              failed: {
                title: 'Renewal saved — no email went out',
                body: `No mail app opened, so ${email} has not been told. Copy the new link and send it yourself.`,
              },
            });
          },
        },
      ],
    );
  }, [upsertPrequalPacket, setReviewingPacket, signOff]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Prequal + COI · MAGE ID</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>Subcontractor compliance</Text>
        </View>
      </View>

      <ScrollView
        {...fabScroll}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void onPullRefresh(); }} tintColor={themeColors.accent} />}
      >

        {/* Counts */}
        <View style={styles.statsRow}>
          <Stat label="Approved" value={counts.approved} color={themeColors.success} />
          <Stat label="Pending" value={counts.pending} color={themeColors.info} />
          <Stat label="Issues" value={counts.issues} color={Colors.warningLabel} />
          <Stat label="No packet" value={counts.none} color={themeColors.textSecondary} />
        </View>

        <View style={styles.banner}>
          <ShieldCheck size={16} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.bannerText}>
            OSHA{"\u2019"}s Multi-Employer Citation Policy treats the GC as a controlling employer —
            expired COIs can cost $16,550 per instance.
          </Text>
        </View>

        {/* Renewals needed */}
        {rows.filter(r => r.bucket === '7d' || r.bucket === '30d' || r.bucket === 'expired').length > 0 && (
          <View style={styles.renewCard}>
            <View style={styles.renewHeader}>
              <Clock size={14} color={Colors.warningLabel} strokeWidth={1.75} />
              <Text style={styles.renewTitle}>Renewals needed</Text>
            </View>
            {/* #32: a list you can act on — each row opens the renewal sheet.
                It used to be text only, and the review modal it did not open
                had no way to renew either. */}
            {rows.filter(r => r.bucket === '7d' || r.bucket === '30d' || r.bucket === 'expired').map(r => (
              <TouchableOpacity
                key={r.sub.id}
                style={styles.renewRow}
                onPress={() => { if (r.packet) setRenewing({ packet: r.packet, sub: r.sub }); }}
                accessibilityRole="button"
                accessibilityLabel={`Send renewal to ${r.sub.companyName}`}
              >
                <Text style={styles.renewItem}>
                  • {r.sub.companyName} — {r.bucket === 'expired' ? 'expired' : `renews within ${r.bucket}`}
                </Text>
                <Text style={styles.renewAction}>Send renewal</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Insurance marketplace CTA — surfaces only when renewals are
            needed, since that's the moment the GC actually cares about
            shopping the policy. See RevenueEarlyAccessCard for context. */}
        {rows.filter(r => r.bucket === '7d' || r.bucket === '30d' || r.bucket === 'expired').length > 0 && (
          <RevenueEarlyAccessCard
            eventKey="revenue.insurance.coi_requote"
            icon={Scale}
            headline="Renewal quotes for expiring sub insurance"
            body="We are working on requesting renewal quotes for a sub's expiring coverage, pre-filled from the COI on file. No insurer or broker is signed up yet."
            footer="Not available yet — tap to be told when it is"
            testID="coi-requote-cta"
          />
        )}

        {/* Sub list */}
        {rows.length === 0 ? (
          <View style={styles.emptyBox}>
            <ShieldAlert size={24} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyText}>No subcontractors on file. Add one from the Subs directory to invite a packet.</Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            {rows.map(({ sub, packet, review, bucket, renewsOn }, idx) => (
              <TouchableOpacity
                key={sub.id}
                style={[styles.subRow, idx > 0 && styles.subRowBorder]}
                onPress={() => {
                  if (!packet) {
                    setInvitingSub(sub);
                  } else if (packet.status === 'submitted' || packet.status === 'in_progress') {
                    setReviewingPacket(packet);
                  } else {
                    setReviewingPacket(packet);
                  }
                }}
              >
                <StatusBadge status={packet?.status} bucket={bucket} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.subName}>{sub.companyName}</Text>
                  <Text style={styles.subSub} numberOfLines={1}>
                    {sub.trade} · {sub.contactName || 'No contact'}
                    {renewsOn ? ` · Renews ${renewsOn}` : ''}
                  </Text>
                  {review && review.overall !== 'pass' && review.missingFields.length > 0 && (
                    <Text style={styles.subMissing}>Missing: {review.missingFields.slice(0, 2).join(', ')}{review.missingFields.length > 2 ? ` +${review.missingFields.length - 2}` : ''}</Text>
                  )}
                </View>
                <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={styles.footerNote}>
          Subs fill out their packet via a magic link — no login required. Auto-review flags
          any criterion failure; manual approval is always available.
        </Text>
      </ScrollView>

      {/* Invite modal */}
      <InviteModal
        sub={invitingSub}
        onClose={() => setInvitingSub(null)}
        onSend={(email) => {
          if (!invitingSub) return;
          handleInvite(invitingSub, email);
          setInvitingSub(null);
        }}
      />

      {/* Renewal sheet (#32) — same email sheet, prefilled from the packet */}
      <InviteModal
        sub={renewing ? (renewing.sub ?? subcontractors.find(s => s.id === renewing.packet.subcontractorId) ?? null) : null}
        renewal={renewing ? { email: renewing.packet.inviteEmail ?? '', approved: renewing.packet.status === 'approved' } : null}
        onClose={() => setRenewing(null)}
        onSend={(email) => {
          if (!renewing) return;
          handleRenew(renewing.packet, renewing.sub ?? subcontractors.find(s => s.id === renewing.packet.subcontractorId) ?? null, email);
        }}
      />

      {/* Review modal */}
      <ReviewModal
        packet={reviewingPacket}
        freshness={freshness}
        sub={reviewingPacket ? subcontractors.find(s => s.id === reviewingPacket.subcontractorId) ?? null : null}
        onClose={() => setReviewingPacket(null)}
        onApprove={handleApprove}
        onNeedsChanges={handleNeedsChanges}
        onReject={handleReject}
        onRenew={(packet) => {
          const sub = subcontractors.find(s => s.id === packet.subcontractorId) ?? null;
          setReviewingPacket(null);
          setRenewing({ packet, sub });
        }}
        onResendNote={handleResendNote}
        writePrequalReview={writePrequalReview}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function StatusBadge({ status, bucket }: { status?: PrequalStatus; bucket?: string | null }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  let Icon = ShieldAlert;
  let color = themeColors.textSecondary;
  let label = 'No packet';

  if (!status) {
    // default
  } else if (status === 'approved' && bucket === 'expired') {
    Icon = ShieldX; color = themeColors.danger; label = 'Expired';
  } else if (status === 'approved') {
    Icon = ShieldCheck; color = themeColors.success; label = 'Approved';
  } else if (status === 'submitted' || status === 'in_progress') {
    Icon = Clock; color = themeColors.info; label = 'Review';
  } else if (status === 'invited' || status === 'draft') {
    Icon = Send; color = themeColors.info; label = 'Invited';
  } else if (status === 'needs_changes') {
    Icon = AlertTriangle; color = Colors.warningLabel; label = 'Changes';
  } else if (status === 'rejected') {
    Icon = ShieldX; color = themeColors.danger; label = 'Rejected';
  }

  return (
    <View style={[styles.statusBadge, { backgroundColor: `${color}18` }]}>
      <Icon size={14} color={color} />
      <Text style={[styles.statusBadgeText, { color }]}>{label}</Text>
    </View>
  );
}

// ─── Invite modal ────────────────────────────────────────────

function InviteModal({ sub, renewal, onClose, onSend }: {
  sub: Subcontractor | null; onClose: () => void; onSend: (email: string) => void;
  /** Set for a renewal of an existing packet (#32): the address it was last
   *  sent to, and whether it is currently approved (the copy says what the
   *  renewal costs). */
  renewal?: { email: string; approved: boolean } | null;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [email, setEmail] = useState<string>('');
  React.useEffect(() => { setEmail(renewal?.email || sub?.email || ''); }, [sub, renewal?.email]);
  const fInvite = useSheetFrame('form', { visible: !!sub, animationType: 'slide' });
  const send = () => {
    if (!email.trim() || !email.includes('@')) {
      showAlert('Email needed', 'Enter the sub\'s email address.');
      return;
    }
    onSend(email.trim());
  };
  // Emails the sub an invite: Cmd+Enter only, never Cmd+S (components/ui/Sheet saveKey).
  useSheetPrimaryHotkey(!!sub, send, { saveKey: false });

  return (
    <Modal visible={!!sub} animationType={fInvite.animationType} transparent onRequestClose={onClose}>
      <View style={[styles.modalOverlay, fInvite.overlay]}>
        <View style={[styles.modalCard, fInvite.card]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{renewal ? 'Send renewal to' : 'Invite'} {sub?.companyName ?? 'sub'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
          </View>
          <View style={{ padding: 16 }}>
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="sub@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Text style={styles.inviteHelp}>
              {renewal
                ? `We\u2019ll compose a message with a NEW link. The old link stops working${renewal.approved ? ' and the packet leaves \u201capproved\u201d until they resubmit' : ''}. Their previous answers are kept as the starting point.`
                : 'We\u2019ll compose a message with a magic link. The sub can fill out the packet without creating an account.'}
            </Text>
          </View>
          <View style={styles.modalFooter}>
            <TouchableOpacity onPress={onClose} style={styles.btnGhost}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={send}
              style={styles.btnPrimary}
            >
              <Send size={16} color={'#FFFFFF'} strokeWidth={1.75} />
              <Text style={styles.btnPrimaryText}>{renewal ? 'Send renewal' : 'Send invite'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Review modal ────────────────────────────────────────────

function ReviewModal({ packet, freshness, sub, onClose, onApprove, onNeedsChanges, onReject, onRenew, onResendNote, writePrequalReview }: {
  packet: PrequalPacket | null;
  /** #24 — whether `packet` is the row just re-read, still being re-read, or
   *  this phone's cached copy (offline). Decisions wait for 'checking'. */
  freshness: { state: 'checking' | 'fresh' | 'cached'; readAt?: number } | null;
  sub: Subcontractor | null;
  onRenew: (packet: PrequalPacket) => void;
  onResendNote: (packet: PrequalPacket) => void;
  onClose: () => void;
  onApprove: (packet: PrequalPacket) => void;
  onNeedsChanges: (packet: PrequalPacket, note: string) => void;
  onReject: (packet: PrequalPacket, note: string) => void;
  /** The context's narrow review write (#24), threaded down from
   *  PrequalManagerInner — the pipeline advance sends the status only. */
  writePrequalReview: (id: string, patch: PrequalReviewPatch) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [note, setNote] = useState<string>('');
  React.useEffect(() => { if (packet) setNote(packet.reviewerNotes ?? ''); }, [packet]);

  const review: PrequalReviewResult | null = useMemo(() => packet ? reviewPrequalPacket(packet) : null, [packet]);
  const fReview = useSheetFrame('form', { visible: !!packet, animationType: 'slide' });

  if (!packet) return null;

  const canCopyLink = !!packet.inviteToken;
  const checking = !freshness || freshness.state === 'checking';
  const renewable = canSendPrequalRenewal(packet.status, packet.expiresAt ? renewalBucket(packet.expiresAt) : null);
  const cachedReadAt = freshness?.state === 'cached' && freshness.readAt
    ? new Date(freshness.readAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  // Every date shown in this modal goes through formatPacketDate — see its
  // docblock. A bare `new Date(x).toLocaleDateString()` renders the literal
  // string "Invalid Date" for a corrupt stamp, and prints the previous calendar
  // day for anything stored date-only.
  const invitedOn = formatPacketDate(packet.inviteSentAt);
  const submittedOn = formatPacketDate(packet.submittedAt);
  // Falls back to the raw string, not '—', when it will not parse: coiExpiry is
  // free text the sub typed, and this is the panel where a reviewer needs to
  // SEE that they typed "next March".
  const coiExpiryDisplay = formatPacketDate(packet.insurance.coiExpiry) ?? packet.insurance.coiExpiry ?? '—';

  return (
    <Modal visible animationType={fReview.animationType} transparent onRequestClose={onClose}>
      <View style={[styles.modalOverlay, fReview.overlay]}>
        <View style={[styles.modalCard, { maxHeight: '92%' }, fReview.card]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{sub?.companyName ?? 'Packet'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 560 }}>
            <View style={{ padding: 16 }}>
              {/* Lifecycle breadcrumb — shows the packet's position in the
                  draft → invited → in_progress → submitted → approved pipeline.
                  The advance button is blocked on side branches (needs_changes /
                  rejected / expired) and on "submitted": advancing submitted →
                  approved must go through handleApprove, which also computes
                  expiresAt via computePrequalExpiry and snapshots
                  autoReviewFindings. A bare status write here would approve the
                  packet without either. Use the Approve / Needs changes / Reject
                  footer buttons for those transitions. */}
              <View style={{ marginBottom: 12 }}>
                {/* Same treatment as app/permits.tsx, deliberately — one visual
                    language for "this item is off the normal path". A side
                    branch has no position in the sequence, so the breadcrumb
                    anchors it at Draft; without this badge the modal claims a
                    REJECTED packet is a draft, with a filled dot and nothing to
                    contradict it. The badge carries the real state, the
                    breadcrumb just stays rendered instead of collapsing. */}
                {isSideBranch('prequal', packet.status) && (
                  <View style={styles.sideBranchBadge}>
                    <AlertTriangle size={13} color={themeColors.dangerLabel} strokeWidth={2} />
                    <Text style={styles.sideBranchText}>
                      {PREQUAL_SIDE_BRANCH_LABEL[packet.status] ?? packet.status} — not on the normal path
                    </Text>
                  </View>
                )}
                <StatusPipeline
                  stages={stagesFor('prequal')}
                  current={visualStageFor('prequal', packet.status)}
                  startedAt={packet.createdAt}
                  dueAt={packet.expiresAt || undefined}
                  onAdvance={
                    // #24: no advance until the re-read has landed — the write
                    // below spreads the packet it is given.
                    checking || isSideBranch('prequal', packet.status) || packet.status === 'submitted'
                      ? undefined
                      : (next) => {
                          // #24: status only — never the sub's answers.
                          writePrequalReview(packet.id, {
                            status: next as PrequalPacket['status'],
                            updatedAt: new Date().toISOString(),
                          });
                        }
                  }
                />
              </View>

              {/* Summary. "Auto-review passed. Ready for approval." is a
                  RECOMMENDATION, and on a side branch a human (or the calendar)
                  has already overruled it — a rejected packet is not ready for
                  approval, and an expired one is not either. Showing the green
                  banner anyway is half of the contradiction the audit flagged,
                  so the pass banner is suppressed there; nothing is lost,
                  because every criterion it summarises is listed in full
                  directly below. The fail / needs-info banners stay: those
                  AGREE with a side branch and explain how it got there. */}
              {review && !(review.overall === 'pass' && isSideBranch('prequal', packet.status)) && (
                <View style={[styles.reviewSummary, {
                  backgroundColor: review.overall === 'pass' ? themeColors.successSoft : review.overall === 'fail' ? themeColors.dangerSoft : themeColors.warningSoft,
                  borderLeftColor: review.overall === 'pass' ? themeColors.success : review.overall === 'fail' ? themeColors.danger : Colors.warning,
                }]}>
                  <Text style={styles.reviewSummaryText}>{review.summary}</Text>
                </View>
              )}

              {/* #24 — where the answers on this sheet came from. */}
              {freshness?.state === 'cached' && (
                <View style={styles.staleNote} testID="prequal-review-cached">
                  <AlertTriangle size={13} color={Colors.warningLabel} strokeWidth={1.75} />
                  <Text style={styles.staleNoteText}>
                    Couldn{"\u2019"}t reach the server — this may be out of date{cachedReadAt ? ` (last read ${cachedReadAt})` : ''}. The sub may have submitted since.
                  </Text>
                </View>
              )}

              {/* #111 — the decision note, resendable when the mail composer was dismissed. */}
              {(packet.status === 'needs_changes' || packet.status === 'rejected') && (
                <TouchableOpacity style={styles.copyLinkRow} onPress={() => onResendNote(packet)} accessibilityRole="button">
                  <Mail size={14} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.copyLinkText}>Resend note to the sub</Text>
                </TouchableOpacity>
              )}

              {/* #32 — renew a decided, lapsed or due packet. */}
              {renewable && (
                <TouchableOpacity style={styles.copyLinkRow} onPress={() => onRenew(packet)} disabled={checking} accessibilityRole="button" accessibilityState={{ disabled: checking }}>
                  <RefreshCw size={14} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.copyLinkText}>Send renewal</Text>
                </TouchableOpacity>
              )}

              {/* Magic-link share */}
              {canCopyLink && (
                <TouchableOpacity
                  style={styles.copyLinkRow}
                  onPress={async () => {
                    const link = prequalInviteUrl(packet.inviteToken ?? '');
                    const ok = await copyToClipboard(link);
                    showAlert(
                      ok ? 'Copied' : 'Copy failed',
                      ok ? 'Magic link copied to clipboard.' : 'Could not copy the link.',
                    );
                  }}
                >
                  <Copy size={14} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.copyLinkText}>Copy magic link</Text>
                </TouchableOpacity>
              )}

              {/* Findings */}
              <Text style={styles.sectionLabel}>Auto-review findings</Text>
              {review?.findings.map(f => (
                <View key={f.criterion} style={styles.findingRow}>
                  {f.passed
                    ? <CheckCircle2 size={14} color={themeColors.success} strokeWidth={1.75} />
                    : <AlertTriangle size={14} color={f.severity === 'blocker' ? themeColors.danger : Colors.warning} strokeWidth={1.75} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.findingLabel}>{f.label}</Text>
                    {f.note ? <Text style={styles.findingNote}>{f.note}</Text> : null}
                  </View>
                </View>
              ))}

              {/* Packet details */}
              <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Packet details</Text>
              <DetailLine label="Status" value={packet.status} />
              {invitedOn && <DetailLine label="Invited" value={invitedOn} />}
              {submittedOn && <DetailLine label="Submitted" value={submittedOn} />}
              <DetailLine label="CGL per occurrence" value={packet.insurance.cglPerOccurrence ? `$${packet.insurance.cglPerOccurrence.toLocaleString()}` : '—'} />
              <DetailLine label="CGL aggregate" value={packet.insurance.cglAggregate ? `$${packet.insurance.cglAggregate.toLocaleString()}` : '—'} />
              <DetailLine label="Workers Comp" value={packet.insurance.workersCompActive ? `Active · ${packet.insurance.workersCompCarrier ?? '—'}` : 'Not confirmed'} />
              <DetailLine label="CG 20 10" value={packet.insurance.hasCG2010 ? 'Attested' : 'Missing'} />
              <DetailLine label="CG 20 37" value={packet.insurance.hasCG2037 ? 'Attested' : 'Missing'} />
              <DetailLine label="COI expiry" value={coiExpiryDisplay} />
              <DetailLine label="W-9" value={packet.w9OnFile ? 'On file' : 'Missing'} />
              <DetailLine label="Licenses" value={`${packet.licenses.length} on file`} />
              <DetailLine label="Years in business" value={String(packet.financials.yearsInBusiness ?? '—')} />

              {/* Reviewer note */}
              <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Reviewer note (optional)</Text>
              <TextInput
                style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
                value={note}
                onChangeText={setNote}
                placeholder="e.g. Waiting on CG 20 10 endorsement from carrier, ETA next week."
                multiline
              />
            </View>
          </ScrollView>

          {checking && (
            <Text style={styles.checkingNote} testID="prequal-review-checking">Checking for the sub{"\u2019"}s latest answers…</Text>
          )}
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.btnGhost, { flex: 0.8 }, checking && styles.btnDisabled]}
              onPress={() => onReject(packet, note || 'Rejected by reviewer')}
              disabled={checking}
              accessibilityState={{ disabled: checking }}
            >
              <ShieldX size={14} color={themeColors.danger} strokeWidth={1.75} />
              <Text style={[styles.btnGhostText, { color: themeColors.danger }]}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnGhost, { flex: 1 }, checking && styles.btnDisabled]}
              onPress={() => onNeedsChanges(packet, note || 'Please provide missing fields')}
              disabled={checking}
              accessibilityState={{ disabled: checking }}
            >
              <AlertTriangle size={14} color={Colors.warningLabel} strokeWidth={1.75} />
              <Text style={[styles.btnGhostText, { color: Colors.warningLabel }]}>Needs changes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnPrimary, { flex: 1 }, checking && styles.btnDisabled]}
              onPress={() => onApprove(packet)}
              disabled={checking}
              accessibilityState={{ disabled: checking }}
            >
              <CheckCircle2 size={14} color={'#FFFFFF'} strokeWidth={1.75} />
              <Text style={styles.btnPrimaryText}>Approve</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLineLabel}>{label}</Text>
      <Text style={styles.detailLineValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 12, paddingTop: 6,
    gap: 8, borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: Tokens.radius.xl, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.surfaceAlt,
  },
  headerText: { flex: 1 },
  headerEyebrow: { fontSize: 10, color: t.accent, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' },
  headerTitle: { ...Type.serifHeadline, color: t.text },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  statCard: {
    flex: 1, backgroundColor: Colors.card, borderRadius: Tokens.radius.md, padding: 12, alignItems: 'center',
  },
  statValue: { fontSize: Type.title2.fontSize, fontWeight: '800' },
  statLabel: { fontSize: 10, color: t.textSecondary, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },

  banner: {
    backgroundColor: Colors.card, padding: 12, borderRadius: Tokens.radius.md, borderLeftWidth: 3, borderLeftColor: t.accent,
    marginBottom: 12, flexDirection: 'row', gap: 8, alignItems: 'flex-start',
  },
  bannerText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.textSecondary, lineHeight: 16 },

  renewCard: {
    backgroundColor: t.warningSoft, padding: 12, borderRadius: Tokens.radius.md, marginBottom: 14,
    borderWidth: 1, borderColor: `${Colors.warning}30`,
  },
  renewHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  renewTitle: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: Colors.warningLabel, textTransform: 'uppercase', letterSpacing: 0.5 },
  renewItem: { fontSize: Type.caption1.fontSize, color: t.text, marginTop: 2 },

  listCard: { backgroundColor: Colors.card, borderRadius: Tokens.radius.card, overflow: 'hidden' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  subRowBorder: { borderTopWidth: 1, borderTopColor: t.line },
  subName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  subSub: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 2 },
  subMissing: { fontSize: 10, color: Colors.warningLabel, marginTop: 2, fontWeight: '600' },

  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 7, minWidth: 82 },
  statusBadgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },

  emptyBox: { alignItems: 'center', padding: 40 },
  emptyText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, textAlign: 'center', marginTop: 8 },
  footerNote: { fontSize: 10, color: t.textMuted, textAlign: 'center', marginTop: 16, paddingHorizontal: 14, lineHeight: 14 },

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.overlay },
  modalCard: { backgroundColor: Colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '92%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: t.line },
  modalTitle: { fontSize: Type.body.fontSize, fontWeight: '700', color: t.text },
  modalFooter: { flexDirection: 'row', gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: t.line },

  btnGhost: { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', borderRadius: Tokens.radius.md, backgroundColor: Colors.fillSecondary },
  btnGhostText: { color: t.text, fontSize: Type.footnote.fontSize, fontWeight: '700' },
  btnPrimary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: Tokens.radius.md, backgroundColor: t.accentFill },
  btnPrimaryText: { color: '#FFFFFF', fontSize: Type.footnote.fontSize, fontWeight: '700' },

  fieldLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  input: { backgroundColor: Colors.fillSecondary, borderRadius: Tokens.radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: Type.bodyCompact.fontSize, color: t.text },
  inviteHelp: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 8, lineHeight: 15 },

  // Matches app/permits.tsx's permitSideBranchBadge token for token — same
  // meaning, same look. dangerLabel (not danger) is the AA-contrast red.
  sideBranchBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', marginBottom: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1, borderColor: t.dangerLabel,
  },
  sideBranchText: {
    fontSize: Type.caption1.fontSize, color: t.dangerLabel, fontWeight: '700' as const,
  },

  reviewSummary: { borderRadius: Tokens.radius.md, padding: 12, borderLeftWidth: 3, marginBottom: 14 },
  reviewSummaryText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },

  sectionLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },

  findingRow: { flexDirection: 'row', gap: 8, paddingVertical: 6, alignItems: 'flex-start' },
  findingLabel: { fontSize: Type.caption1.fontSize, color: t.text, fontWeight: '600' },
  findingNote: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 1 },

  copyLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, marginBottom: 6 },
  btnDisabled: { opacity: 0.45 },
  checkingNote: { fontSize: Type.caption2.fontSize, color: t.textSecondary, textAlign: 'center', paddingTop: 10, paddingHorizontal: 16 },
  staleNote: {
    flexDirection: 'row', gap: 6, alignItems: 'flex-start', padding: 10, marginBottom: 10,
    borderRadius: Tokens.radius.md, backgroundColor: t.warningSoft,
  },
  staleNoteText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.text, lineHeight: 16 },
  renewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 4 },
  renewAction: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '700' },
  copyLinkText: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '600' },

  detailLine: { flexDirection: 'row', paddingVertical: 4 },
  detailLineLabel: { flex: 0.4, fontSize: Type.caption1.fontSize, color: t.textSecondary },
  detailLineValue: { flex: 0.6, fontSize: Type.caption1.fontSize, color: t.text, textAlign: 'right' },
});
