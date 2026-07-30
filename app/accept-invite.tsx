// app/accept-invite.tsx
//
// Redeems a project-collaboration invite (Live Schedule Collaboration Phase 1).
// Opened via the tokenized email link `…/accept-invite?token=<token>`.
//
// Flow: store the token (survives a sign-in round-trip); if the invitee is
// signed in, call the `project-invite` edge function `accept` action and route
// into the project; if not, prompt sign-in (the token stays valid — they can
// re-open the link after signing in).

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { MageAIMark } from '@/components/icons';

const PENDING_KEY = 'mageid_pending_invite';
type Status = 'idle' | 'accepting' | 'done' | 'error' | 'signin';

export default function AcceptInvite() {
  const { colors: t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isAuthenticated, user } = useAuth();
  const params = useLocalSearchParams<{ token?: string }>();

  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);

  // Persist the token immediately so it survives a sign-in round-trip.
  useEffect(() => {
    if (params.token) void AsyncStorage.setItem(PENDING_KEY, String(params.token));
  }, [params.token]);

  const accept = useCallback(async () => {
    setStatus('accepting');
    setError('');
    const token = String(params.token || (await AsyncStorage.getItem(PENDING_KEY)) || '');
    if (!token) { setStatus('error'); setError('This invite link is missing its token.'); return; }
    const { data, error: fnErr } = await supabase.functions.invoke('project-invite', {
      body: { action: 'accept', token },
    });
    const body = data as { success?: boolean; projectId?: string; error?: string } | null;
    if (fnErr || body?.error || !body?.success) {
      setStatus('error');
      setError(body?.error || (fnErr instanceof Error ? fnErr.message : 'Could not accept the invite.'));
      return;
    }
    await AsyncStorage.removeItem(PENDING_KEY);
    setProjectId(body.projectId ?? null);
    setStatus('done');
  }, [params.token]);

  // Auto-accept once the invitee is signed in.
  useEffect(() => {
    if (isAuthenticated && user?.id && status === 'idle') void accept();
    else if (!isAuthenticated && status === 'idle') setStatus('signin');
  }, [isAuthenticated, user?.id, status, accept]);

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.center}>
        <View style={[styles.iconWrap, { backgroundColor: t.accentSoft }]}>
          <MageAIMark size={30} color={t.accent} />
        </View>

        {status === 'accepting' ? (
          <>
            <ActivityIndicator color={t.accent} style={{ marginVertical: 16 }} />
            <Text style={[styles.title, { color: t.text }]}>Accepting your invite…</Text>
          </>
        ) : status === 'done' ? (
          <>
            <Text style={[styles.title, { color: t.text }]}>You're in!</Text>
            <Text style={[styles.sub, { color: t.textSecondary }]}>You can now collaborate on this project.</Text>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: t.accent }]}
              onPress={() => (projectId ? router.replace({ pathname: '/project-detail', params: { id: projectId } }) : router.replace('/'))}
              accessibilityRole="button"
            >
              <Text style={styles.btnText}>Open the project</Text>
            </TouchableOpacity>
          </>
        ) : status === 'signin' ? (
          <>
            <Text style={[styles.title, { color: t.text }]}>You've been invited to collaborate</Text>
            <Text style={[styles.sub, { color: t.textSecondary }]}>Sign in or create a free account to accept. Your invite stays valid — you can re-open this link after signing in.</Text>
            <TouchableOpacity style={[styles.btn, { backgroundColor: t.accent }]} onPress={() => router.push('/login')} accessibilityRole="button">
              <Text style={styles.btnText}>Sign in to accept</Text>
            </TouchableOpacity>
          </>
        ) : status === 'error' ? (
          <>
            <Text style={[styles.title, { color: t.text }]}>Couldn't accept the invite</Text>
            <Text style={[styles.sub, { color: t.danger }]}>{error}</Text>
            <TouchableOpacity style={[styles.btn, { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }]} onPress={() => setStatus('idle')} accessibilityRole="button">
              <Text style={[styles.btnText, { color: t.text }]}>Try again</Text>
            </TouchableOpacity>
          </>
        ) : (
          <ActivityIndicator color={t.accent} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  iconWrap: { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { fontSize: Type.title3.fontSize, fontWeight: '800', textAlign: 'center' },
  sub: { fontSize: Type.subhead.fontSize, textAlign: 'center', lineHeight: 22, marginTop: 4 },
  btn: { marginTop: 20, borderRadius: Tokens.radius.lg, paddingVertical: 16, paddingHorizontal: 28, alignItems: 'center', minWidth: 220 },
  btnText: { fontSize: Type.callout.fontSize, fontWeight: '800', color: '#FFF' },
});
