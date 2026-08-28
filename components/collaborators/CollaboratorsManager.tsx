// components/collaborators/CollaboratorsManager.tsx
//
// Invite + manage project collaborators (Live Schedule Collaboration Phase 1).
// Owner-only controls; editors/viewers see the roster read-only. Inviting is
// gated to Pro (below Pro → /paywall). Because the invite email is best-effort
// (Resend may be unconfigured), we surface a copyable invite link too.

import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { UserPlus, Trash2, Copy, Check, Mail } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useProjectCollaborators } from '@/hooks/useProjectCollaborators';
import { useProjectRole } from '@/hooks/useProjectRole';
import { ROLE_LABELS, ROLE_DESCRIPTIONS } from '@/utils/roleBlinding';
import { useAccountSeats } from '@/hooks/useAccountSeats';
import { showAlert } from '@/utils/alert';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export function CollaboratorsManager({ projectId }: { projectId: string }) {
  const { colors: t } = useTheme();
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const role = useProjectRole(projectId);
  const isOwner = role === 'owner';
  const { collaborators, isLoading, invite, revoke, changeRole } = useProjectCollaborators(projectId);
  // Account-wide, not per-project: one person on six jobs is one seat.
  const seats = useAccountSeats();

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer' | 'field'>('editor');
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  // What this specific invite costs, computed before it is sent so a charge is
  // never a surprise. Field invites always return bills:false — crew are free.
  const seatPreview = seats.preview(inviteRole, email);

  const onInvite = useCallback(() => {
    if (!validEmail) return;
    if (!canAccess('schedule_collaboration')) { router.push('/paywall'); return; }
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
            setLastLink((data as { link?: string })?.link ?? null);
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
  }, [validEmail, canAccess, router, invite, email, inviteRole, seatPreview, seats]);

  const copyLink = useCallback(async () => {
    if (!lastLink) return;
    await Clipboard.setStringAsync(lastLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [lastLink]);

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
          {/* Seat cost, stated before the invite is sent. */}
          <Text
            style={[styles.seatHint, { color: seatPreview.bills ? t.accentLabel : t.textMuted }]}
            testID="seat-preview"
          >
            {seatPreview.message}
          </Text>
          <TouchableOpacity
            onPress={onInvite}
            disabled={!validEmail || invite.isPending}
            style={[styles.inviteBtn, { backgroundColor: t.accent }, (!validEmail || invite.isPending) && { opacity: 0.5 }]}
            accessibilityRole="button"
            testID="collab-invite"
          >
            {invite.isPending ? <ActivityIndicator color="#FFF" /> : <UserPlus size={16} color="#FFF" strokeWidth={2} />}
            <Text style={styles.inviteBtnText}>Send invite</Text>
          </TouchableOpacity>
          {invite.isError ? <Text style={[styles.errText, { color: t.danger }]}>{(invite.error as Error)?.message}</Text> : null}
          {lastLink ? (
            <TouchableOpacity onPress={copyLink} style={[styles.linkRow, { backgroundColor: t.accentSoft }]} accessibilityRole="button">
              {copied ? <Check size={14} color={t.success} strokeWidth={2} /> : <Copy size={14} color={t.accent} strokeWidth={2} />}
              <Text style={[styles.linkText, { color: t.accent }]} numberOfLines={1}>
                {copied ? 'Link copied' : 'Copy invite link (share if the email doesn’t arrive)'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Roster */}
      {isLoading ? (
        <ActivityIndicator color={t.accent} />
      ) : collaborators.length === 0 ? (
        <Text style={[styles.empty, { color: t.textMuted }]}>No collaborators yet{isOwner ? ' — invite your first above.' : '.'}</Text>
      ) : (
        collaborators.map((c) => (
          <View key={c.id} style={[styles.row, { borderColor: t.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowEmail, { color: t.text }]} numberOfLines={1}>{c.email}</Text>
              <Text style={[styles.rowMeta, { color: t.textSecondary }]}>
                {ROLE_LABELS[c.role] ?? 'Owner'} · {c.status === 'accepted' ? 'Active' : 'Invited'}
              </Text>
            </View>
            {isOwner ? (
              <>
                <TouchableOpacity
                  onPress={() => changeRole.mutate({ collaboratorId: c.id, role: c.role === 'editor' ? 'viewer' : 'editor' })}
                  style={[styles.smallChip, { borderColor: t.line }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch to ${c.role === 'editor' ? 'viewer' : 'editor'}`}
                >
                  <Text style={[styles.smallChipText, { color: t.textSecondary }]}>{c.role === 'editor' ? 'Make viewer' : 'Make editor'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => revoke.mutate(c.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Revoke">
                  <Trash2 size={16} color={t.danger} strokeWidth={1.75} />
                </TouchableOpacity>
              </>
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
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  linkText: { flex: 1, fontSize: Type.caption1.fontSize, fontWeight: '700' },
  empty: { fontSize: Type.subhead.fontSize, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: Tokens.radius.card, padding: 12 },
  rowEmail: { fontSize: Type.subhead.fontSize, fontWeight: '700' },
  rowMeta: { fontSize: Type.caption1.fontSize, marginTop: 1 },
  smallChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  smallChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' },
});
