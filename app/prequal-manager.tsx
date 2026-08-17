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

import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Modal, TextInput, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { PRIMARY_SCHEME } from '@/utils/deepLinkScheme';
import {
  ShieldCheck, ShieldAlert, ShieldX, Clock, Send, ChevronRight,
  ChevronLeft, X, CheckCircle2, AlertTriangle, Copy, Scale,
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
  reviewPrequalPacket, generatePrequalToken, computePrequalExpiry, renewalBucket,
  type PrequalReviewResult,
} from '@/utils/prequalEngine';
import {
  DEFAULT_PREQUAL_CRITERIA,
  type PrequalPacket,
  type PrequalStatus,
  type Subcontractor,
} from '@/types';
import { StatusPipeline } from '@/components/StatusPipeline';
import { stagesFor, visualStageFor, isSideBranch } from '@/utils/workflowPipelines';

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
  const router = useRouter();
  const { subcontractors, upsertPrequalPacket, getPrequalPacketForSub } = useProjects();

  const [reviewingPacket, setReviewingPacket] = useState<PrequalPacket | null>(null);
  const [invitingSub, setInvitingSub] = useState<Subcontractor | null>(null);

  // Build a row per sub with packet+status+review info.
  const rows = useMemo(() => {
    return subcontractors.map(sub => {
      const packet = getPrequalPacketForSub(sub.id);
      const review = packet && packet.status !== 'draft' && packet.status !== 'invited'
        ? reviewPrequalPacket(packet)
        : null;
      const bucket = packet?.expiresAt ? renewalBucket(packet.expiresAt) : null;
      return { sub, packet, review, bucket };
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
    const link = `${PRIMARY_SCHEME}prequal-form?token=${token}`;
    const subject = encodeURIComponent(`Prequalification for ${sub.companyName}`);
    const body = encodeURIComponent(
      `Hi ${sub.contactName || 'there'},\n\n` +
      `Please complete our subcontractor prequalification form. This keeps your paperwork current and unlocks bid invites from us — it takes about 10 minutes and you don't need a login.\n\n` +
      `Start here: ${link}\n\n` +
      `If the link doesn't open, tell us your preferred email and we'll resend.\n\n` +
      `Thanks,\nMAGE ID`
    );
    void Linking.openURL(`mailto:${email}?subject=${subject}&body=${body}`).catch(() => {});
  }, [getPrequalPacketForSub, upsertPrequalPacket]);

  const handleApprove = useCallback((packet: PrequalPacket) => {
    const now = new Date().toISOString();
    const updated: PrequalPacket = {
      ...packet,
      status: 'approved',
      reviewedAt: now,
      expiresAt: computePrequalExpiry(now, packet.insurance.coiExpiry),
      autoReviewFindings: reviewPrequalPacket(packet).findings.map(f => ({
        criterion: f.criterion, passed: f.passed, note: f.note,
      })),
      updatedAt: now,
    };
    upsertPrequalPacket(updated);
    setReviewingPacket(null);
  }, [upsertPrequalPacket]);

  const handleNeedsChanges = useCallback((packet: PrequalPacket, note: string) => {
    const now = new Date().toISOString();
    upsertPrequalPacket({
      ...packet,
      status: 'needs_changes',
      reviewerNotes: note,
      reviewedAt: now,
      updatedAt: now,
    });
    setReviewingPacket(null);
  }, [upsertPrequalPacket]);

  const handleReject = useCallback((packet: PrequalPacket, note: string) => {
    const now = new Date().toISOString();
    upsertPrequalPacket({
      ...packet,
      status: 'rejected',
      reviewerNotes: note,
      reviewedAt: now,
      updatedAt: now,
    });
    setReviewingPacket(null);
  }, [upsertPrequalPacket]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Prequal + COI · MAGE</Text>
          <Text style={styles.headerTitle}>Subcontractor compliance</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 + insets.bottom }}>

        {/* Counts */}
        <View style={styles.statsRow}>
          <Stat label="Approved" value={counts.approved} color={themeColors.success} />
          <Stat label="Pending" value={counts.pending} color={themeColors.info} />
          <Stat label="Issues" value={counts.issues} color={Colors.warning} />
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
              <Clock size={14} color={Colors.warning} strokeWidth={1.75} />
              <Text style={styles.renewTitle}>Renewals needed</Text>
            </View>
            {rows.filter(r => r.bucket === '7d' || r.bucket === '30d' || r.bucket === 'expired').map(r => (
              <Text key={r.sub.id} style={styles.renewItem}>
                • {r.sub.companyName} — {r.bucket === 'expired' ? 'expired' : `renews within ${r.bucket}`}
              </Text>
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
            headline="Compare renewal quotes from 3 brokers"
            body="Coterie + Next Insurance + Hiscox quote your sub in 60 seconds. We pre-fill from the existing COI on file."
            footer="Insurance partner LOI in progress · early access shipping Q3 2026"
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
            {rows.map(({ sub, packet, review, bucket }, idx) => (
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
                    {packet?.expiresAt ? ` · Renews ${packet.expiresAt}` : ''}
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

      {/* Review modal */}
      <ReviewModal
        packet={reviewingPacket}
        sub={reviewingPacket ? subcontractors.find(s => s.id === reviewingPacket.subcontractorId) ?? null : null}
        onClose={() => setReviewingPacket(null)}
        onApprove={handleApprove}
        onNeedsChanges={handleNeedsChanges}
        onReject={handleReject}
        upsertPrequalPacket={upsertPrequalPacket}
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
    Icon = AlertTriangle; color = Colors.warning; label = 'Changes';
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

function InviteModal({ sub, onClose, onSend }: {
  sub: Subcontractor | null; onClose: () => void; onSend: (email: string) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [email, setEmail] = useState<string>('');
  React.useEffect(() => { setEmail(sub?.email ?? ''); }, [sub]);

  return (
    <Modal visible={!!sub} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Invite {sub?.companyName ?? 'sub'}</Text>
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
              We{"\u2019"}ll compose a message with a magic link. The sub can fill out the packet without
              creating an account.
            </Text>
          </View>
          <View style={styles.modalFooter}>
            <TouchableOpacity onPress={onClose} style={styles.btnGhost}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (!email.trim() || !email.includes('@')) {
                  showAlert('Email needed', 'Enter the sub\'s email address.');
                  return;
                }
                onSend(email.trim());
              }}
              style={styles.btnPrimary}
            >
              <Send size={16} color={'#FFFFFF'} strokeWidth={1.75} />
              <Text style={styles.btnPrimaryText}>Send invite</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Review modal ────────────────────────────────────────────

function ReviewModal({ packet, sub, onClose, onApprove, onNeedsChanges, onReject, upsertPrequalPacket }: {
  packet: PrequalPacket | null;
  sub: Subcontractor | null;
  onClose: () => void;
  onApprove: (packet: PrequalPacket) => void;
  onNeedsChanges: (packet: PrequalPacket, note: string) => void;
  onReject: (packet: PrequalPacket, note: string) => void;
  /** Passed down from PrequalManagerInner — upsertPrequalPacket is not in scope
   *  inside this component, so it is threaded in as a prop. */
  upsertPrequalPacket: (packet: PrequalPacket) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [note, setNote] = useState<string>('');
  React.useEffect(() => { if (packet) setNote(packet.reviewerNotes ?? ''); }, [packet]);

  const review: PrequalReviewResult | null = useMemo(() => packet ? reviewPrequalPacket(packet) : null, [packet]);

  if (!packet) return null;

  const canCopyLink = !!packet.inviteToken;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { maxHeight: '92%' }]}>
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
                    isSideBranch('prequal', packet.status) || packet.status === 'submitted'
                      ? undefined
                      : (next) => {
                          upsertPrequalPacket({
                            ...packet,
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

              {/* Magic-link share */}
              {canCopyLink && (
                <TouchableOpacity
                  style={styles.copyLinkRow}
                  onPress={async () => {
                    const link = `${PRIMARY_SCHEME}prequal-form?token=${packet.inviteToken}`;
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
              {packet.inviteSentAt && <DetailLine label="Invited" value={new Date(packet.inviteSentAt).toLocaleDateString()} />}
              {packet.submittedAt && <DetailLine label="Submitted" value={new Date(packet.submittedAt).toLocaleDateString()} />}
              <DetailLine label="CGL per occurrence" value={packet.insurance.cglPerOccurrence ? `$${packet.insurance.cglPerOccurrence.toLocaleString()}` : '—'} />
              <DetailLine label="CGL aggregate" value={packet.insurance.cglAggregate ? `$${packet.insurance.cglAggregate.toLocaleString()}` : '—'} />
              <DetailLine label="Workers Comp" value={packet.insurance.workersCompActive ? `Active · ${packet.insurance.workersCompCarrier ?? '—'}` : 'Not confirmed'} />
              <DetailLine label="CG 20 10" value={packet.insurance.hasCG2010 ? 'Attested' : 'Missing'} />
              <DetailLine label="CG 20 37" value={packet.insurance.hasCG2037 ? 'Attested' : 'Missing'} />
              <DetailLine label="COI expiry" value={packet.insurance.coiExpiry ?? '—'} />
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

          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.btnGhost, { flex: 0.8 }]}
              onPress={() => onReject(packet, note || 'Rejected by reviewer')}
            >
              <ShieldX size={14} color={themeColors.danger} strokeWidth={1.75} />
              <Text style={[styles.btnGhostText, { color: themeColors.danger }]}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnGhost, { flex: 1 }]}
              onPress={() => onNeedsChanges(packet, note || 'Please provide missing fields')}
            >
              <AlertTriangle size={14} color={Colors.warning} strokeWidth={1.75} />
              <Text style={[styles.btnGhostText, { color: Colors.warning }]}>Needs changes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={() => onApprove(packet)}>
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
  headerTitle: { fontSize: Type.body.fontSize, fontWeight: '700', color: t.text },

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
  renewTitle: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: Colors.warning, textTransform: 'uppercase', letterSpacing: 0.5 },
  renewItem: { fontSize: Type.caption1.fontSize, color: t.text, marginTop: 2 },

  listCard: { backgroundColor: Colors.card, borderRadius: Tokens.radius.card, overflow: 'hidden' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  subRowBorder: { borderTopWidth: 1, borderTopColor: t.line },
  subName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  subSub: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 2 },
  subMissing: { fontSize: 10, color: Colors.warning, marginTop: 2, fontWeight: '600' },

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
  btnPrimary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: Tokens.radius.md, backgroundColor: t.accent },
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
  copyLinkText: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '600' },

  detailLine: { flexDirection: 'row', paddingVertical: 4 },
  detailLineLabel: { flex: 0.4, fontSize: Type.caption1.fontSize, color: t.textSecondary },
  detailLineValue: { flex: 0.6, fontSize: Type.caption1.fontSize, color: t.text, textAlign: 'right' },
});
