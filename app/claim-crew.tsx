import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, TextInput, Platform, Linking } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useCrew } from '@/contexts/CrewContext';
import {
  redeemCrewClaim, requestFreshClaimLink, classifyClaimFailure, parseAuthLinkError, claimAppPath,
} from '@/utils/crewScan';
import { edgeErrorCode } from '@/utils/edgeError';
import { setPendingDeepLink } from '@/utils/pendingDeepLink';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { ClaimedWorkerSelfView } from './crew';

// Worker claim redemption. Opened from the magic-link invite
// (https://app.mageid.app/claim-crew?token=crew_...). MagicLinkHandler
// (app/_layout.tsx) establishes the session from the URL hash; once
// authenticated we redeem the claim token via the SERVICE-ROLE claim-crew edge
// function — NOT a client context mutation. The claiming worker is a different
// auth user than the GC, and crew_members RLS makes the unclaimed row
// invisible + un-writable to them, so a client-side redeem always fails.
// Public destination — RootLayoutNav must NOT bounce it to /login before the
// session lands (added to the allow-list).
//
// Every state has a way forward (#73). A magic link is good for one tap and
// 60 minutes; a worker who opened the invite that evening, or twice, used to
// sit on "Confirming your profile…" forever — GoTrue put the error on the URL
// (#error_code=otp_expired), MagicLinkHandler only logged it, and 'Go to app'
// was hidden for the whole wait. The claim TOKEN is still unspent in that
// case, so the screen says so and gets him a fresh sign-in link.

/** Seconds of no session after auth has finished loading before we stop
 *  waiting and offer a new link. Measured from the END of AuthContext's own
 *  loading, so a slow cold start doesn't trip it. */
const SESSION_WAIT_MS = 8000;

type ClaimState =
  | 'waiting'          // no session yet, still inside the wait
  | 'redeeming'        // the claim-crew request is in flight
  | 'done'
  | 'link_expired'     // the sign-in link failed; the invite is fine
  | 'retry'            // couldn't reach the server; the invite is fine
  | 'already_claimed'
  | 'invalid';

export default function ClaimCrewScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { crewMembers } = useCrew();
  const queryClient = useQueryClient();
  const { colors: themeColors } = useTheme();
  const [state, setState] = useState<ClaimState>(token ? 'waiting' : 'invalid');
  const [retryKey, setRetryKey] = useState(0);
  const [linkError, setLinkError] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  // Built per theme: this screen's page background and body ink were baked at
  // import, so a worker who opens the invite link in dark mode landed on a
  // light-grey page (audit 2026-09-07).
  const styles = useThemedStyles(makeStyles);

  // ── 1. The link's own error (expired / already used) ──────────────────────
  useEffect(() => {
    const note = (url: string | null | undefined) => {
      if (parseAuthLinkError(url)) setLinkError(true);
    };
    if (Platform.OS === 'web') {
      try {
        if (typeof window !== 'undefined') note(window.location.href);
      } catch { /* no location — nothing to read */ }
      return;
    }
    Linking.getInitialURL().then(note).catch(() => { /* no initial URL */ });
    const sub = Linking.addEventListener('url', ({ url }) => note(url));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (linkError && !isAuthenticated && (state === 'waiting' || state === 'redeeming')) setState('link_expired');
  }, [linkError, isAuthenticated, state]);

  // ── 2. No session after the wait → the same honest state ─────────────────
  useEffect(() => {
    if (!token || authLoading || isAuthenticated || state !== 'waiting') return;
    const t = setTimeout(() => setState(s => (s === 'waiting' ? 'link_expired' : s)), SESSION_WAIT_MS);
    return () => clearTimeout(t);
  }, [token, authLoading, isAuthenticated, state]);

  // ── 3. Redeem once there is a session ─────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    if (!isAuthenticated || !user?.id) return; // wait for magic-link session
    let cancelled = false;
    setState('redeeming');
    (async () => {
      try {
        await redeemCrewClaim(token);
        if (cancelled) return;
        // The row is now visible to the worker via RLS (auth.uid() =
        // claimed_by_user_id) — refetch the roster so it hydrates in-app.
        void queryClient.invalidateQueries({ queryKey: ['crew_members'] });
        setState('done');
      } catch (e) {
        if (cancelled) return;
        const kind = classifyClaimFailure(edgeErrorCode(e));
        setState(kind === 'retry' ? 'retry'
          : kind === 'sign_in' ? 'link_expired'
          : kind === 'already_claimed' ? 'already_claimed'
          : 'invalid');
      }
    })();
    return () => { cancelled = true; };
  }, [token, isAuthenticated, user?.id, queryClient, retryKey]);

  const myRows = useMemo(
    () => (user?.id ? crewMembers.filter(m => m.claimedByUserId === user.id) : []),
    [crewMembers, user?.id],
  );

  const handleSignIn = useCallback(async () => {
    if (!token) return;
    try {
      // The claim address as an in-app path; login's replay brings him back
      // here with a session, and the redeem runs.
      await setPendingDeepLink(claimAppPath(token));
    } catch {
      // Storage unavailable: he still reaches /login; the fresh-link option
      // below works without it.
    }
    router.replace('/login');
  }, [token, router]);

  const handleSendFresh = useCallback(async () => {
    if (!token) return;
    const addr = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addr)) {
      setSendError('Enter the email the invite was sent to.');
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      await requestFreshClaimLink(addr, token);
      setSentTo(addr);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Couldn't send a new link. Try again.");
    } finally {
      setSending(false);
    }
  }, [email, token]);

  // ── done: his profile, right here ─────────────────────────────────────────
  // claim-crew is exempt from every gate; /crew is not (a new account has no
  // persona yet and would be sent to contractor setup). So the profile he was
  // just told he can edit renders on this screen (#74).
  if (state === 'done') {
    return (
      <View style={styles.page}>
        <Stack.Screen options={{ title: 'Claim profile' }} />
        {myRows.length > 0 ? (
          <ClaimedWorkerSelfView
            members={myRows}
            embedded
            header={(
              <View style={styles.doneHeader}>
                <Text style={styles.title}>Profile claimed</Text>
                <Text style={styles.msg}>
                  This is your crew profile. Keep your phone, email and trades up to date here.
                </Text>
              </View>
            )}
            footer={(
              <Text style={styles.linkMuted} onPress={() => router.replace('/')} accessibilityRole="link">
                Set up your own MAGE account
              </Text>
            )}
          />
        ) : (
          <View style={styles.container}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.msg}>Profile claimed. Loading it…</Text>
            <Text style={styles.linkMuted} onPress={() => router.replace('/')} accessibilityRole="link">
              Set up your own MAGE account
            </Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Claim profile' }} />

      {(state === 'waiting' || state === 'redeeming') && (
        <>
          <ActivityIndicator color={Colors.primary} />
          <Text style={styles.msg}>Confirming your profile…</Text>
        </>
      )}

      {state === 'link_expired' && (
        <View style={styles.block} testID="claim-link-expired">
          <Text style={styles.msg}>
            This sign-in link has expired or was already used. Your invite is still good. Sign in to finish claiming your profile.
          </Text>
          {sentTo ? (
            <Text style={styles.msg}>We sent a new link to {sentTo}. Open it on this device to finish.</Text>
          ) : (
            <>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="The email the invite was sent to"
                placeholderTextColor={themeColors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                testID="claim-fresh-email"
              />
              {sendError ? <Text style={styles.errorText}>{sendError}</Text> : null}
              <TouchableOpacity
                style={[styles.primaryBtn, sending && styles.btnDisabled]}
                onPress={handleSendFresh}
                disabled={sending}
                activeOpacity={0.85}
                accessibilityRole="button"
                testID="claim-send-fresh"
              >
                <Text style={styles.primaryBtnText}>{sending ? 'Sending…' : 'Email me a new link'}</Text>
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={handleSignIn}
            activeOpacity={0.85}
            accessibilityRole="button"
            testID="claim-sign-in"
          >
            <Text style={styles.secondaryBtnText}>Sign in</Text>
          </TouchableOpacity>
        </View>
      )}

      {state === 'retry' && (
        <View style={styles.block}>
          <Text style={styles.msg}>Couldn’t reach MAGE ID. Your invite is still good.</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => setRetryKey(k => k + 1)}
            activeOpacity={0.85}
            accessibilityRole="button"
            testID="claim-retry"
          >
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {state === 'already_claimed' && (
        <Text style={styles.msg}>This invite link has already been used. Ask the contractor to resend it.</Text>
      )}
      {state === 'invalid' && (
        <Text style={styles.msg}>This invite link is invalid or already used. Ask the contractor to resend it.</Text>
      )}

      {/* A way out in every state except the few seconds a redeem is actually
          in flight (it was hidden for the whole wait). */}
      {state !== 'redeeming' && (
        <Text style={styles.linkMuted} onPress={() => router.replace('/')} accessibilityRole="link">Go to app</Text>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: t.bg },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg, padding: 24, gap: 16 },
  block: { width: '100%', maxWidth: 420, gap: 12, alignItems: 'stretch' },
  doneHeader: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12, gap: 6 },
  title: { fontSize: Type.title3.fontSize, fontWeight: '700', color: t.text },
  msg: { fontSize: Type.body.fontSize, color: t.text, textAlign: 'center' },
  errorText: { fontSize: Type.footnote.fontSize, color: t.danger, textAlign: 'center' },
  input: {
    minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: t.surfaceAlt,
    paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: t.text,
  },
  primaryBtn: {
    minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: t.accentFill,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16,
  },
  primaryBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: '#FFFFFF' },
  secondaryBtn: {
    minHeight: 48, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16,
  },
  secondaryBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  btnDisabled: { opacity: 0.5 },
  linkMuted: { fontSize: Type.body.fontSize, color: t.textSecondary, fontWeight: '600', textAlign: 'center', paddingVertical: 8 },
});
