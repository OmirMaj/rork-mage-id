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
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export function CollaboratorsManager({ projectId }: { projectId: string }) {
  const { colors: t } = useTheme();
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const role = useProjectRole(projectId);
  const isOwner = role === 'owner';
  const { collaborators, isLoading, invite, revoke, changeRole } = useProjectCollaborators(projectId);

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  const onInvite = useCallback(() => {
    if (!validEmail) return;
    if (!canAccess('schedule_collaboration')) { router.push('/paywall'); return; }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    invite.mutate(
      { email: email.trim().toLowerCase(), role: inviteRole },
      {
        onSuccess: (data) => { setLastLink((data as { link?: string })?.link ?? null); setEmail(''); },
      },
    );
  }, [validEmail, canAccess, router, invite, email, inviteRole]);

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
            {(['editor', 'viewer'] as const).map((r) => (
              <TouchableOpacity
                key={r}
                onPress={() => setInviteRole(r)}
                style={[styles.roleChip, { borderColor: t.line }, inviteRole === r && { backgroundColor: t.accentSoft, borderColor: t.accent }]}
                accessibilityRole="button"
              >
                <Text style={[styles.roleChipText, { color: inviteRole === r ? t.accent : t.textSecondary }]}>
                  {r === 'editor' ? 'Editor · can edit' : 'Viewer · read-only'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
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
                {c.role === 'editor' ? 'Editor' : c.role === 'viewer' ? 'Viewer' : 'Owner'} · {c.status === 'accepted' ? 'Active' : 'Invited'}
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
