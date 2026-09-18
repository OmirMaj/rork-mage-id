// components/collaborators/PendingInvitesCard.tsx
//
// "You've been invited" on Home — the recovery path for a collaboration invite
// that never made it through the emailed link (audit round 2 #29).
//
// The link is fragile in exactly the case the field role is for: a first-time
// foreman. On iPhone the https link opens Safari (app.json has no
// associatedDomains), so signing up in the app leaves the token behind in a
// browser; a new account's pre-session wipe clears the stashed copy; and an
// email sign-up has no session until the confirmation link. He finished
// onboarding into an empty app, and the GC's roster said "Invited" forever.
//
// This card asks the server which invites are waiting for the signed-in
// user's VERIFIED email (project-invite `listPending`, service role — he cannot
// read the project row or the inviter's profile until he is a member) and
// accepts by id (`acceptPending`, the same email check `accept` makes on a
// token). Renders nothing while loading, on error, or with nothing waiting:
// it is a discovery card, and an empty or failed state has nothing to act on.

import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react-native';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Card, Button, IconWrapper } from '@/components/ui';
import { ROLE_DESCRIPTIONS } from '@/utils/roleBlinding';
import { parsePendingInvites, pendingInviteHeadline, type PendingInvite } from '@/utils/deepLinksInvite';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function PendingInvitesCard() {
  const { colors: t } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  const query = useQuery({
    // A react-query key (memory only), not a storage key.
    queryKey: ['pending-invites', userId],
    enabled: !!userId && isSupabaseConfigured,
    // Invites arrive by email, not by anything this device does; a minute of
    // staleness is fine and keeps Home from calling the function on every focus.
    staleTime: 60_000,
    queryFn: async (): Promise<PendingInvite[]> => {
      const { data, error } = await supabase.functions.invoke('project-invite', { body: { action: 'listPending' } });
      if (error) throw error;
      return parsePendingInvites(data);
    },
  });

  const accept = useCallback(async (inv: PendingInvite) => {
    setAcceptingId(inv.collaboratorId);
    setErrorById((m) => ({ ...m, [inv.collaboratorId]: '' }));
    try {
      const { data, error } = await supabase.functions.invoke('project-invite', {
        body: { action: 'acceptPending', collaboratorId: inv.collaboratorId },
      });
      const body = data as { success?: boolean; projectId?: string; error?: string } | null;
      if (error || !body?.success) {
        setErrorById((m) => ({
          ...m,
          [inv.collaboratorId]: body?.error || (error instanceof Error ? error.message : "Couldn't accept the invite. Try again."),
        }));
        void query.refetch();
        return;
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Everything on Home was read before he was a member of this job.
      void qc.invalidateQueries();
      router.push({ pathname: '/project-detail', params: { id: body.projectId ?? inv.projectId } });
    } finally {
      setAcceptingId(null);
    }
  }, [qc, query, router]);

  const invites = query.data ?? [];
  if (!userId || invites.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {invites.map((inv) => {
        const err = errorById[inv.collaboratorId];
        const desc = ROLE_DESCRIPTIONS[inv.role as keyof typeof ROLE_DESCRIPTIONS];
        return (
          <Card key={inv.collaboratorId} testID={`pending-invite-${inv.collaboratorId}`}>
            <View style={styles.head}>
              <IconWrapper icon={UserPlus} size="sm" tone="accent" />
              <Text style={[styles.title, { color: t.text }]}>{pendingInviteHeadline(inv)}</Text>
            </View>
            {desc ? <Text style={[styles.meta, { color: t.textSecondary }]}>{desc}</Text> : null}
            {err ? <Text style={[styles.meta, { color: t.danger }]}>{err}</Text> : null}
            <Button
              label="Accept invite"
              size="sm"
              onPress={() => { void accept(inv); }}
              loading={acceptingId === inv.collaboratorId}
              disabled={acceptingId !== null}
              style={styles.btn}
              testID={`pending-invite-accept-${inv.collaboratorId}`}
            />
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Tokens.spacing.sm, marginBottom: Tokens.spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs },
  title: { ...Type.headline, flex: 1 },
  meta: { ...Type.footnote, marginTop: 6 },
  btn: { marginTop: Tokens.spacing.sm, alignSelf: 'flex-start' },
});
