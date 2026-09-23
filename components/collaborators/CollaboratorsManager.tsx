// components/collaborators/CollaboratorsManager.tsx
//
// Invite + manage project collaborators (Live Schedule Collaboration Phase 1).
// Owner-only controls; editors/viewers see the roster read-only. Because the
// invite email is best-effort (Resend may be unconfigured), we surface a
// copyable invite link too.
//
// ── WHAT IS GATED, AND WHAT IS DELIBERATELY NOT ─────────────────────────────
// Inviting an ADMIN collaborator (editor / viewer — the roles that read
// financials) is gated to Pro via schedule_collaboration. Inviting a FIELD
// collaborator is NOT gated at any tier.
//
// This used to be wrong, and it was wrong in the expensive direction. The
// canAccess('schedule_collaboration') check sat ABOVE the role, so it fired for
// role 'field' too: a free-tier GC who picked "Field" and tapped Send Invite was
// bounced to /paywall and could not add a single sub. The server would have
// allowed it — supabase/functions/project-invite/index.ts:220 calls seatCheck()
// only when isBillableRole(role) is true, so a field invite passes at every
// tier — and utils/seatModel previewSeat('free', …, 'field') returns
// allowed:true, which scripts/validate-seat-model.ts has asserted the whole
// time. The CLIENT was the only thing refusing, and it refused the exact
// promise the marketing site makes ("subcontractors are always free").
//
// So the tier check is now asked only about the roles it is actually about.
// Keep it below the role test: a field invite must never reach /paywall.
//
// ── THE ROSTER ROLE PICKER (audit round 2 #27) ──────────────────────────────
// Each row used to carry ONE chip, `role === 'editor' ? 'viewer' : 'editor'`.
// On a Field row that read "Make editor": one tap, no dialog, and the foreman
// saw the job's estimate, markup and contract terms from his next load — the
// numbers the field role exists to keep from the crew. Nothing could set Field
// on an existing row, so the only way back was to re-invite him, which reset
// his row to 'pending' and locked him out of the whole project. Now every row
// has the same Editor / Viewer / Field picker the invite form has, a move that
// LIFTS financial blinding asks first and names what they will see, and
// re-inviting an active member is refused (here, and by project-invite,
// which answers code 'already_member').
//
// ── REMOVING SOMEONE, AND THE LINK AFTER YOU LEAVE (#95, #177) ──────────────
// The trash icon used to revoke on touch — no dialog, no undo, and a failure
// (weak signal on site) rendered nothing, so the GC thought the super was off
// the job while he still had it. It now confirms, shows a spinner on that row
// while the server answers, and says out loud when the person STILL has
// access. It stays OUTSIDE utils/offlineQueue on purpose: removing access is a
// server-authoritative permission change, and a queued "removed" that has not
// happened yet is exactly the false comfort this fixes.
// The invite's email outcome is now reported (emailSent), and a pending row
// carries "Copy link", which re-reads the CURRENT link (getLink) instead of
// re-sending — re-sending rotates the token and kills a link already texted.

import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { UserPlus, Trash2, Copy, Check, Mail, Link2 } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useProjectCollaborators } from '@/hooks/useProjectCollaborators';
import { useProjectRole } from '@/hooks/useProjectRole';
import { rosterView, inviteBlockedReason, ROSTER_ERROR_LINE, ROSTER_OFFLINE_LINE } from '@/utils/projectRole';
import { ROLE_LABELS, ROLE_DESCRIPTIONS, FIELD_ROLE_SCOPE_NOTE, isFinancialsBlinded } from '@/utils/roleBlinding';
import { useAccountSeats } from '@/hooks/useAccountSeats';
import { isBillableSeat } from '@/utils/seatModel';
import type { ProjectCollaborator } from '@/types';
import { showAlert } from '@/utils/alert';
import { Button } from '@/components/ui';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export function CollaboratorsManager({ projectId }: { projectId: string }) {
  const { colors: t } = useTheme();
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const role = useProjectRole(projectId);
  const isOwner = role === 'owner';
  const { collaborators, isLoading, isError, isPaused, hasData, refetch, invite, revoke, changeRole, getLink } = useProjectCollaborators(projectId);
  // #129: a failed or offline read is NOT an empty team. Only a read that has
  // answered may say "No collaborators yet"; until then the invite form is
  // off with its reason (the "already on this job" check needs the list).
  const view = rosterView({ isLoading, isError, isPaused, hasData, count: collaborators.length });
  const inviteBlocked = inviteBlockedReason(view);
  // Account-wide, not per-project: one person on six jobs is one seat.
  const seats = useAccountSeats();

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer' | 'field'>('editor');
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // #177: what happened to the last invite's email. `sent: null` = a function
  // deployed before emailSent existed — neither claim is made then.
  const [lastSend, setLastSend] = useState<{ email: string; sent: boolean | null } | null>(null);
  // #177: which pending row's link was just copied (row-level "Copy link").
  const [rowCopiedId, setRowCopiedId] = useState<string | null>(null);

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  // What this specific invite costs, computed before it is sent so a charge is
  // never a surprise. Field invites always return bills:false — crew are free.
  const seatPreview = seats.preview(inviteRole, email);

  const onInvite = useCallback(() => {
    if (!validEmail) return;
    if (inviteBlocked) { showAlert("Can't send the invite yet", inviteBlocked); return; }
    // Someone already active on this job is never re-invited: the invite
    // resets his row to 'pending' and he loses the project until he accepts
    // again. Point at the row's role picker instead.
    const typed = email.trim().toLowerCase();
    const active = collaborators.find((c) => c.status === 'accepted' && c.email.trim().toLowerCase() === typed);
    if (active) {
      showAlert(
        'Already on this job',
        `${active.email} is already here as ${ROLE_LABELS[active.role] ?? active.role}. To change what they can see, use the role buttons on their row below. Sending a new invite would lock them out until they accept it again.`,
      );
      return;
    }
    // Role FIRST, tier second — see the header. Field invites are free at every
    // tier and must never be bounced to the paywall.
    if (isBillableSeat(inviteRole) && !canAccess('schedule_collaboration')) { router.push('/paywall'); return; }
    // Out of seats (or free tier). The edge function enforces the same limit
    // and would return 402, so route to the upgrade instead of firing a
    // request we know will fail.
    if (!seatPreview.allowed) {
      showAlert(
        'Out of team seats',
        `${seatPreview.message}\n\nField collaborators don't use a seat — if they only need the schedule, daily reports, photos and RFIs, invite them as Field.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'See plans', onPress: () => router.push('/paywall') },
        ],
      );
      return;
    }
    const send = () => {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      invite.mutate(
        { email: email.trim().toLowerCase(), role: inviteRole },
        {
          onSuccess: (data) => {
            setLastLink(data?.link ?? null);
            setLastSend({ email: typed, sent: typeof data?.emailSent === 'boolean' ? data.emailSent : null });
            setEmail('');
            void seats.refetch();
          },
        },
      );
    };
    // Confirm before adding a billable seat. Silently charging for an invite is
    // exactly the surprise that makes people distrust per-seat pricing.
    if (seatPreview.bills) {
      showAlert(
        'This adds a paid seat',
        `${seatPreview.message}\n\nField access stays free — if they only need the schedule, daily reports and photos, invite them as Field instead.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: `Add seat · $${seatPreview.addedMonthlyUsd}/mo`, onPress: send },
        ],
      );
      return;
    }
    send();
  }, [validEmail, inviteBlocked, canAccess, router, invite, email, inviteRole, seatPreview, seats, collaborators]);

  // Change an existing collaborator's role from the row picker.
  const requestRoleChange = useCallback((c: ProjectCollaborator, next: 'editor' | 'viewer' | 'field') => {
    if (c.role === next || changeRole.isPending) return;
    const label = ROLE_LABELS[next];
    const run = () => {
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
      changeRole.mutate(
        { collaboratorId: c.id, role: next },
        {
          onSuccess: () => { void seats.refetch(); },
          onError: (err) => showAlert("Couldn't change the role", (err as Error)?.message ?? 'Please try again.'),
        },
      );
    };
    // Field → Editor/Viewer is an UPGRADE into a paid seat. Same rules as an
    // invite (the server's changeRole runs the same seatCheck and would 402).
    // No /paywall push here — the invite gate is the one routing point.
    let seatLine = '';
    if (isBillableSeat(next) && !isBillableSeat(c.role)) {
      if (!canAccess('schedule_collaboration')) {
        showAlert(
          `${label} needs a Pro plan`,
          `Editors and viewers use a team seat, which starts on Pro. ${c.email} can stay on Field — free — with the schedule, daily reports, photos and RFIs.`,
        );
        return;
      }
      const preview = seats.preview(next, c.email);
      if (!preview.allowed) {
        showAlert('Out of team seats', `${preview.message}\n\n${c.email} can stay on Field, which doesn't use a seat.`);
        return;
      }
      if (preview.bills) seatLine = `\n\n${preview.message}`;
    }
    // Lifting financial blinding is the one move that needs a second look:
    // one mis-tap used to hand the crew the job's markup.
    if (isFinancialsBlinded(c.role) && !isFinancialsBlinded(next)) {
      showAlert(
        `Make ${c.email} ${next === 'editor' ? 'an' : 'a'} ${label}?`,
        `${label}s see costs, margins, the estimate and contract terms on this job.${seatLine}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: `Make ${label}`, onPress: run },
        ],
      );
      return;
    }
    run();
  }, [changeRole, canAccess, seats]);

  const copyLink = useCallback(async () => {
    if (!lastLink) return;
    await Clipboard.setStringAsync(lastLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [lastLink]);

  // #95: removal asks first and names the cost of a mistake; a failure says the
  // person STILL has access, because the row staying put said nothing.
  const requestRevoke = useCallback((c: ProjectCollaborator) => {
    if (revoke.isPending) return;
    showAlert(
      `Remove ${c.email} from this job?`,
      "They lose access right away. To bring them back you'll have to send a new invite, and they'll have to accept it again.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            revoke.mutate(c.id, {
              onSuccess: () => { void seats.refetch(); },
              onError: (err) => showAlert(
                `Couldn't remove ${c.email}`,
                `${(err as Error)?.message || 'Check your connection and try again.'}\n\nThey still have access to this job.`,
              ),
            });
          },
        },
      ],
    );
  }, [revoke, seats]);

  // #177: copy a pending invite's CURRENT link, any time after sending it.
  const copyRowLink = useCallback((c: ProjectCollaborator) => {
    if (getLink.isPending) return;
    getLink.mutate(c.id, {
      onSuccess: async (data) => {
        if (!data?.link) return;
        await Clipboard.setStringAsync(data.link);
        setRowCopiedId(c.id);
        setTimeout(() => setRowCopiedId((cur) => (cur === c.id ? null : cur)), 1500);
      },
      onError: (err) => showAlert("Couldn't get the invite link", (err as Error)?.message || 'Check your connection and try again.'),
    });
  }, [getLink]);

  return (
    <View style={{ gap: 12 }}>
      {/* Invite form — owner only */}
      {isOwner ? (
        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.line }]}>
          <Text style={[styles.cardTitle, { color: t.text }]}>Invite a collaborator</Text>

          {/* Account-wide seat state. Field seats are shown alongside so the
              free-forever crew allowance is visible, not buried in pricing. */}
          {seats.status.included > 0 ? (
            <View
              style={[
                styles.seatBar,
                {
                  borderColor: seats.status.overage > 0 ? t.accent + '40' : t.line,
                  backgroundColor: seats.status.overage > 0 ? t.accentSoft : t.bg,
                },
              ]}
            >
              <Text style={[styles.seatBarText, { color: t.textSecondary }]}>
                <Text style={{ color: t.text, fontWeight: '700' }}>
                  {seats.status.used}/{seats.status.included}
                </Text>
                {' '}team seats used
                {seats.status.overage > 0
                  ? ` · ${seats.status.overage} extra · $${seats.status.overageMonthlyUsd}/mo`
                  : ''}
                {seats.counts.field > 0
                  ? ` · ${seats.counts.field} field seat${seats.counts.field === 1 ? '' : 's'} (free)`
                  : ''}
              </Text>
            </View>
          ) : null}
          <View style={styles.inputRow}>
            <Mail size={16} color={t.textMuted} strokeWidth={1.75} />
            <TextInput
              style={[styles.input, { color: t.text }]}
              value={email}
              onChangeText={setEmail}
              placeholder="teammate@email.com"
              placeholderTextColor={t.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
              testID="collab-email"
            />
          </View>
          <View style={styles.roleRow}>
            {(['editor', 'viewer', 'field'] as const).map((r) => (
              <TouchableOpacity
                key={r}
                onPress={() => setInviteRole(r)}
                style={[styles.roleChip, { borderColor: t.line }, inviteRole === r && { backgroundColor: t.accentSoft, borderColor: t.accent }]}
                accessibilityRole="button"
              >
                <Text style={[styles.roleChipText, { color: inviteRole === r ? t.accent : t.textSecondary }]}>
                  {ROLE_LABELS[r]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.roleHint, { color: t.textMuted }]}>{ROLE_DESCRIPTIONS[inviteRole]}</Text>
          {/* #176: the field promise stated at its real strength until the
              server withholds the legacy money columns (phase 2). */}
          {inviteRole === 'field' ? (
            <Text style={[styles.roleHint, { color: t.textMuted }]} testID="field-scope-note">{FIELD_ROLE_SCOPE_NOTE}</Text>
          ) : null}
          {/* Seat cost, stated before the invite is sent. */}
          <Text
            style={[styles.seatHint, { color: seatPreview.bills ? t.accentLabel : t.textMuted }]}
            testID="seat-preview"
          >
            {seatPreview.message}
          </Text>
          <TouchableOpacity
            onPress={onInvite}
            disabled={!validEmail || invite.isPending || !!inviteBlocked}
            style={[styles.inviteBtn, { backgroundColor: t.accentFill }, (!validEmail || invite.isPending || !!inviteBlocked) && { opacity: 0.5 }]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !validEmail || invite.isPending || !!inviteBlocked }}
            accessibilityHint={inviteBlocked ?? undefined}
            testID="collab-invite"
          >
            {invite.isPending ? <ActivityIndicator color="#FFF" /> : <UserPlus size={16} color="#FFF" strokeWidth={2} />}
            <Text style={styles.inviteBtnText}>Send invite</Text>
          </TouchableOpacity>
          {/* #129: a blocked control says why. */}
          {inviteBlocked ? (
            <Text style={[styles.roleHint, { color: t.textSecondary }]} testID="collab-invite-blocked">{inviteBlocked}</Text>
          ) : null}
          {invite.isError ? <Text style={[styles.errText, { color: t.danger }]}>{(invite.error as Error)?.message}</Text> : null}
          {/* #177: say what happened to the email — never "Invited" alone. */}
          {lastSend ? (
            <Text
              style={[styles.sendStatus, { color: lastSend.sent === false ? t.danger : t.textSecondary }]}
              testID="invite-email-status"
            >
              {lastSend.sent === true
                ? `Emailed to ${lastSend.email}.`
                : lastSend.sent === false
                  ? `Email not sent to ${lastSend.email} — copy the link below and send it yourself.`
                  : `Invite created for ${lastSend.email}. If the email doesn't arrive, copy the link below.`}
            </Text>
          ) : null}
          {lastLink ? (
            <TouchableOpacity onPress={copyLink} style={[styles.linkRow, { backgroundColor: t.accentSoft }]} accessibilityRole="button">
              {copied ? <Check size={14} color={t.success} strokeWidth={2} /> : <Copy size={14} color={t.accent} strokeWidth={2} />}
              <Text style={[styles.linkText, { color: t.accent }]} numberOfLines={1}>
                {copied ? 'Link copied' : 'Copy invite link'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Roster */}
      {view === 'loading' ? (
        <ActivityIndicator color={t.accent} />
      ) : view === 'error' || view === 'offline' ? (
        <View style={styles.rosterUnknown} testID={`collab-roster-${view}`}>
          <Text style={[styles.empty, { color: t.textSecondary }]}>{view === 'error' ? ROSTER_ERROR_LINE : ROSTER_OFFLINE_LINE}</Text>
          {view === 'error' ? (
            <Button label="Retry" size="sm" variant="secondary" onPress={refetch} testID="collab-roster-retry" />
          ) : null}
        </View>
      ) : view === 'empty' ? (
        <Text style={[styles.empty, { color: t.textMuted }]}>No collaborators yet{isOwner ? ' — invite your first above.' : '.'}</Text>
      ) : (
        collaborators.map((c) => (
          <View key={c.id} style={[styles.row, { borderColor: t.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowEmail, { color: t.text }]} numberOfLines={1}>{c.email}</Text>
              <Text style={[styles.rowMeta, { color: t.textSecondary }]}>
                {ROLE_LABELS[c.role] ?? 'Owner'} · {c.status === 'accepted' ? 'Active' : 'Invited'}
              </Text>
              {/* Role picker — the invite form's chips, per row; the current
                  role is the filled chip. Under the address, not beside it:
                  three chips and the email do not fit one 375pt row. */}
              {isOwner ? (
              <View style={styles.rowRoles} accessibilityRole="radiogroup" accessibilityLabel={`Role for ${c.email}`}>
                {(['editor', 'viewer', 'field'] as const).map((r) => {
                  const current = c.role === r;
                  return (
                    <TouchableOpacity
                      key={r}
                      onPress={() => requestRoleChange(c, r)}
                      disabled={changeRole.isPending}
                      style={[styles.smallChip, { borderColor: t.line }, current && { backgroundColor: t.accentSoft, borderColor: t.accent }]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: current, disabled: changeRole.isPending }}
                      accessibilityLabel={current ? `${ROLE_LABELS[r]}, current role` : `Make ${ROLE_LABELS[r]}`}
                      testID={`collab-role-${c.id}-${r}`}
                    >
                      <Text style={[styles.smallChipText, { color: current ? t.accent : t.textSecondary }]}>{ROLE_LABELS[r]}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              ) : null}
            </View>
            {isOwner && c.status === 'pending' ? (
              <TouchableOpacity
                onPress={() => copyRowLink(c)}
                disabled={getLink.isPending}
                hitSlop={10}
                style={styles.rowIconBtn}
                accessibilityRole="button"
                accessibilityLabel={rowCopiedId === c.id ? 'Invite link copied' : `Copy invite link for ${c.email}`}
                accessibilityHint="Copies the same link the email carried; it does not send a new one"
                testID={`collab-copy-link-${c.id}`}
              >
                {getLink.isPending && getLink.variables === c.id
                  ? <ActivityIndicator size="small" color={t.accent} />
                  : rowCopiedId === c.id
                    ? <Check size={16} color={t.success} strokeWidth={2} />
                    : <Link2 size={16} color={t.accent} strokeWidth={1.75} />}
              </TouchableOpacity>
            ) : null}
            {isOwner ? (
              revoke.isPending && revoke.variables === c.id ? (
                <View style={styles.rowIconBtn} accessibilityLabel={`Removing ${c.email}`}>
                  <ActivityIndicator size="small" color={t.danger} />
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => requestRevoke(c)}
                  disabled={revoke.isPending}
                  hitSlop={10}
                  style={[styles.rowIconBtn, revoke.isPending && { opacity: 0.4 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${c.email}`}
                  accessibilityState={{ disabled: revoke.isPending }}
                  testID={`collab-revoke-${c.id}`}
                >
                  <Trash2 size={16} color={t.danger} strokeWidth={1.75} />
                </TouchableOpacity>
              )
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Tokens.radius.card, padding: 14, gap: 10 },
  cardTitle: { fontSize: Type.footnote.fontSize, fontWeight: '800' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: 'transparent', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: 'rgba(127,127,127,0.08)' },
  input: { flex: 1, fontSize: Type.subhead.fontSize },
  roleRow: { flexDirection: 'row', gap: 8 },
  roleChip: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  roleChipText: { fontSize: Type.caption1.fontSize, fontWeight: '700' },
  roleHint: { fontSize: Type.caption2.fontSize, lineHeight: 15 },
  seatHint: { fontSize: Type.caption2.fontSize, lineHeight: 15, marginTop: 4, fontWeight: '600' },
  seatBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: Tokens.radius.md, borderWidth: 1,
  },
  seatBarText: { flex: 1, fontSize: Type.caption1.fontSize, lineHeight: 16 },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: Tokens.radius.lg, paddingVertical: 13 },
  inviteBtnText: { fontSize: Type.callout.fontSize, fontWeight: '800', color: '#FFF' },
  errText: { fontSize: Type.caption1.fontSize },
  sendStatus: { fontSize: Type.caption1.fontSize, lineHeight: 16, fontWeight: '600' },
  rowIconBtn: { minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  linkText: { flex: 1, fontSize: Type.caption1.fontSize, fontWeight: '700' },
  empty: { fontSize: Type.subhead.fontSize, paddingVertical: 8 },
  rosterUnknown: { gap: 8, alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: Tokens.radius.card, padding: 12 },
  rowEmail: { fontSize: Type.subhead.fontSize, fontWeight: '700' },
  rowMeta: { fontSize: Type.caption1.fontSize, marginTop: 1 },
  rowRoles: { flexDirection: 'row', gap: 6, marginTop: 8 },
  smallChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  smallChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' },
});
