// app/accept-invite.tsx
//
// Redeems a project-collaboration invite (Live Schedule Collaboration Phase 1).
// Opened via the tokenized email link `…/accept-invite?token=<token>`.
//
// Flow: if the invitee is signed in, call the `project-invite` edge function
// `accept` action and route into the project; if not, send him to sign in
// WITH the token on the route (/login?invite=…, utils/deepLinksInvite), and a
// successful sign-in lands back here. The AsyncStorage copy below is only a
// same-session fallback: a brand-new account's pre-session wipe clears every
// 'mageid_' key, which is how the token used to vanish (audit round 2 #29).
// If the link is lost anyway, Home's pending-invite card lists the invite by
// his verified email. An EMAIL sign-up also carries the token on the account
// (user_metadata.invite_token, #107): the root gate routes the confirmed,
// persona-less account here, and this screen clears it once the server has
// answered for good (clearInviteToken).
//
// LEAVING THIS SCREEN (#93 / #94 / #156). This route is exempt from the root
// persona / onboarding gates, so a brand-new account accepts FIRST. Where
// "Open the project" goes depends on how far through first-run he is:
//   • fully set up → REPLACE onto the tab shell, then PUSH the project, the
//     same sequence as onboarding.tsx's sample tour (UX-F18). A bare replace
//     onto /project-detail left a stack of one outside (tabs): no back
//     chevron, no tab bar, and (signed-out path) a stale used-invite page
//     underneath.
//   • no persona yet → persona-select with `invitedProject`. The persona is
//     still asked (a homeowner and a foreman get different homes — recording
//     'contractor' for him would be a guess shown as fact), but the GC's own
//     onboarding (company name, rates, "price your first bid") is skipped and
//     persona-select opens the job itself.
//   • persona but no onboarding → the onboarding step is skipped the same way.
// A pending deep link to the project is stashed on accept as the safety net
// (app killed mid-setup, the param lost to a gate bounce); every path above
// TAKES it before it flips the last gate flag, so the root layout's replay
// never races the explicit navigation — exactly one navigation wins.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Type } from '@/constants/typography';
import { Tokens, Layout } from '@/constants/designTokens';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { MageAIMark } from '@/components/icons';
import { loginHrefForInvite } from '@/utils/deepLinksInvite';
import { useProjects } from '@/contexts/ProjectContext';
import { setPendingDeepLink, takePendingDeepLink } from '@/utils/pendingDeepLink';
import { settleWithin } from '@/utils/projectRole';

const PENDING_KEY = 'mageid_pending_invite';
type Status = 'idle' | 'accepting' | 'done' | 'error' | 'signin';

/**
 * #172: a retry can only help a transient failure. A used or replaced token,
 * an invite addressed to someone else, and a link with no token fail the same
 * way every time — offering "Try again" there was a button that could not work.
 */
function canRetryInvite(errCode: string | null): boolean {
  return errCode !== 'invalid_or_used' && errCode !== 'email_mismatch' && errCode !== 'missing_token';
}

export default function AcceptInvite() {
  const { colors: t } = useTheme();
  const { isDesktop } = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isAuthenticated, user, isLoading: authLoading, clearInviteToken } = useAuth();
  const { userRole, hasSeenOnboarding, completeOnboarding, isLoading: firstRunLoading } = useProjects();
  // userRole reads null WHILE it loads, exactly like "never picked". Deciding
  // on it then would send a set-up user to persona-select, or stash a link his
  // own replay would then fire; nothing below decides until both have settled.
  const firstRunKnown = !firstRunLoading && hasSeenOnboarding !== null;
  const params = useLocalSearchParams<{ token?: string }>();

  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  // #172: the server's code, kept so the error screen offers only what can work.
  const [errCode, setErrCode] = useState<string | null>(null);
  // #93: "Open the project" runs writes (onboarding flag) before navigating.
  const [opening, setOpening] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  // Set when the invite went to a different address than the one signed in
  // (Apple's hidden relay; a personal address when the GC typed the work
  // one). The GC can only fix it by re-inviting THIS address, so it is shown
  // and copyable rather than left as a dead end.
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  // Persist the token immediately so it survives a sign-in round-trip.
  useEffect(() => {
    if (params.token) void AsyncStorage.setItem(PENDING_KEY, String(params.token));
  }, [params.token]);

  const accept = useCallback(async () => {
    setStatus('accepting');
    setError('');
    setErrCode(null);
    const token = String(params.token || (await AsyncStorage.getItem(PENDING_KEY)) || '');
    if (!token) { setStatus('error'); setErrCode('missing_token'); setError('This invite link is missing its token.'); return; }
    const { data, error: fnErr } = await supabase.functions.invoke('project-invite', {
      body: { action: 'accept', token },
    });
    const body = data as { success?: boolean; projectId?: string; error?: string; code?: string; signedInAs?: string } | null;
    if (fnErr || body?.error || !body?.success) {
      setStatus('error');
      const code = typeof body?.code === 'string' ? body.code : null;
      setErrCode(code);
      setError(code === 'invalid_or_used'
        // Local line: says what to do instead of how it failed.
        ? "This link was replaced or already used. If you accepted it before, the project is in your list; if the owner sent you a newer invite, it's waiting on your Home screen."
        : body?.error || (fnErr instanceof Error ? fnErr.message : 'Could not accept the invite.'));
      setSignedInAs(code === 'email_mismatch' && body?.signedInAs ? body.signedInAs : null);
      // A dead token must not be replayed by a later tokenless visit.
      if (code === 'invalid_or_used') await AsyncStorage.removeItem(PENDING_KEY);
      // #107: an answer that can never change (used, replaced, someone else's
      // address) also takes the token off the ACCOUNT, or the root gate would
      // bring a persona-less account back here on every launch. A transient
      // failure keeps it: the next launch gets one more try.
      if (!canRetryInvite(code)) void clearInviteToken(token);
      return;
    }
    await AsyncStorage.removeItem(PENDING_KEY);
    // #111: the project list, its schedule and field data were all read
    // before he was a member. The PROJECT LIST is re-read first, with
    // "Accepting your invite…" still on screen, so "Open the project" finds
    // the job instead of "Project not found" on slow site LTE. Bounded (~8 s);
    // a failed or slow read still lands on 'done' — project-detail holds its
    // loader while the list re-reads and, with justJoined, never claims the
    // job does not exist. Only the projects query is awaited: the other ~30
    // families refetch after it, un-awaited, so they cannot hold this up.
    await settleWithin(queryClient.refetchQueries({ queryKey: ['projects', user?.id] }), 8000);
    void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'projects' });
    // #107: accepted — the token on the account has done its job.
    void clearInviteToken(token);
    setProjectId(body.projectId ?? null);
    setStatus('done');
  }, [params.token, queryClient, user?.id, clearInviteToken]);

  // #93/#156: the safety net. Stashed only while first-run is unfinished — a
  // fully set-up user's replay already ran at mount, so a stash now would
  // linger and fire on his next launch.
  useEffect(() => {
    if (status !== 'done' || !projectId || !firstRunKnown) return;
    if (userRole !== null && hasSeenOnboarding === true) return;
    void setPendingDeepLink(`/project-detail?id=${encodeURIComponent(projectId)}&justJoined=1`);
  }, [status, projectId, userRole, hasSeenOnboarding, firstRunKnown]);

  const openProject = useCallback(async () => {
    if (opening || !firstRunKnown) return;
    if (!projectId) { router.replace('/(tabs)/(home)' as never); return; }
    // Fully set up: tab shell underneath, project on top (#94).
    if (userRole !== null && hasSeenOnboarding === true) {
      router.replace('/(tabs)/(home)' as never);
      router.push({ pathname: '/project-detail', params: { id: projectId, justJoined: '1' } } as never);
      return;
    }
    setOpening(true);
    try {
      if (userRole === null) {
        // The persona is still his to pick; persona-select takes the stash
        // and opens the job once he has.
        router.replace({ pathname: '/persona-select', params: { invitedProject: projectId } } as never);
        return;
      }
      // Persona set, onboarding not: take the stash BEFORE the flag flips, so
      // the root replay finds nothing and this is the one navigation.
      await takePendingDeepLink();
      await completeOnboarding();
      router.replace('/(tabs)/(home)' as never);
      router.push({ pathname: '/project-detail', params: { id: projectId, justJoined: '1' } } as never);
    } catch (err) {
      console.warn('[accept-invite] could not finish setup before opening the project', err);
      setOpening(false);
    }
  }, [opening, firstRunKnown, projectId, userRole, hasSeenOnboarding, completeOnboarding, router]);

  // #172: always a way out. Signed in → Home (the pending-invite card and the
  // project list live there); signed out → login.
  const goHome = useCallback(() => {
    router.replace((isAuthenticated ? '/(tabs)/(home)' : '/login') as never);
  }, [router, isAuthenticated]);

  const copySignedInAs = useCallback(async () => {
    if (!signedInAs) return;
    await Clipboard.setStringAsync(signedInAs);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [signedInAs]);

  // Auto-accept once the invitee is signed in.
  //
  // #107: not before auth has settled. Opened from an email-confirmation link
  // (or a cold start), the session is still being restored — on web
  // detectSessionInUrl is redeeming the link's code — and "not signed in yet"
  // read as "signed out": he was shown "Sign in to accept" and sent to sign in
  // a second time for an account he had just confirmed.
  useEffect(() => {
    if (authLoading) return;
    if (isAuthenticated && user?.id && status === 'idle') void accept();
    else if (!isAuthenticated && status === 'idle') setStatus('signin');
  }, [authLoading, isAuthenticated, user?.id, status, accept]);

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.center, isDesktop && authColumnDesktop]}>
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
            <Text style={[styles.sub, { color: t.textSecondary }]}>
              {userRole === null
                ? "You can now collaborate on this project. One quick question about you first, then we'll open it."
                : 'You can now collaborate on this project.'}
            </Text>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: t.accentFill }, (opening || !firstRunKnown) && { opacity: 0.7 }]}
              onPress={() => { void openProject(); }}
              disabled={opening || !firstRunKnown}
              accessibilityRole="button"
              accessibilityState={{ disabled: opening || !firstRunKnown, busy: opening || !firstRunKnown }}
              testID="accept-invite-open"
            >
              {opening || !firstRunKnown ? (
                <View style={styles.btnRow}>
                  <ActivityIndicator color="#FFF" />
                  <Text style={styles.btnText}>Setting up your account…</Text>
                </View>
              ) : (
                <Text style={styles.btnText}>{projectId ? 'Open the project' : 'Go to Home'}</Text>
              )}
            </TouchableOpacity>
          </>
        ) : status === 'signin' ? (
          <>
            <Text style={[styles.title, { color: t.text }]}>You've been invited to collaborate</Text>
            <Text style={[styles.sub, { color: t.textSecondary }]}>Sign in or create a free account with the address this invite was sent to. You'll come straight back here to accept — and if you lose this page, the invite also waits on your Home screen.</Text>
            <TouchableOpacity style={[styles.btn, { backgroundColor: t.accentFill }]} onPress={() => router.push(loginHrefForInvite(params.token) as never)} accessibilityRole="button">
              <Text style={styles.btnText}>Sign in to accept</Text>
            </TouchableOpacity>
          </>
        ) : status === 'error' ? (
          <>
            <Text style={[styles.title, { color: t.text }]}>Couldn't accept the invite</Text>
            <Text style={[styles.sub, { color: t.danger }]}>{error}</Text>
            {signedInAs ? (
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: t.accentFill }]}
                onPress={copySignedInAs}
                accessibilityRole="button"
                accessibilityHint="Copies the address to send to the project owner"
              >
                <Text style={styles.btnText}>{copied ? 'Copied' : 'Copy my sign-in email'}</Text>
              </TouchableOpacity>
            ) : null}
            {canRetryInvite(errCode) ? (
              <TouchableOpacity style={[styles.btn, { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }]} onPress={() => setStatus('idle')} accessibilityRole="button">
                <Text style={[styles.btnText, { color: t.text }]}>Try again</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }]}
              onPress={goHome}
              accessibilityRole="button"
              testID="accept-invite-home"
            >
              <Text style={[styles.btnText, { color: t.text }]}>{isAuthenticated ? 'Go to Home' : 'Go to sign in'}</Text>
            </TouchableOpacity>
            {isAuthenticated && errCode !== 'invalid_or_used' ? (
              <Text style={[styles.sub, { color: t.textSecondary }]}>If the project owner sent you a newer invite, it's waiting on your Home screen.</Text>
            ) : null}
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
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});

// Desktop web only (wave 6b): login's 480 auth column, from the one width
// source (Layout.page.auth). Appended as `isDesktop && …`, so on a phone the
// style array flattens to exactly what shipped.
const authColumnDesktop = { width: '100%', maxWidth: Layout.page.auth, alignSelf: 'center' } as const;
