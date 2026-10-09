// components/LegalGateHost.tsx — two jobs, mounted ONCE in app/_layout.tsx
// under AuthProvider, beside CodeAckHost (lane PROTECT-SERVER).
//
// 1. ALWAYS: hands the recorder the build and the platform, and sends whatever
//    acceptance records this account still owes the server (a sign-in or an
//    acknowledgement made with no signal, or before the migration was applied):
//    at app start, when the signed-in account changes, and when the app comes
//    to the foreground. Renders nothing for this job. It never records an
//    acceptance by itself: only a sign-in from a screen that shows the Terms
//    sentence, or a tap, does (contexts/AuthContext, components/CodeAckHost,
//    hooks/useScanAck). A confirmation link, a password reset and a restored
//    session record nothing; they only let an owed record be sent.
//
// 2. ONLY WHEN TERMS_REACCEPT_ENABLED IS TRUE (it is false): a full-screen
//    sheet for a signed-in account that has no saved acceptance of the current
//    Terms of Service and Privacy Policy. What changed, a link to each, "I
//    Agree", and "Sign Out". There is no dismiss.
//    With the flag on, an existing account's sign-in records nothing, so
//    signing out and back in cannot skip the sheet: only "I Agree" records.
//    It is shown only when the account's rows were READ and one is missing.
//    Offline, or with the table not on the server yet, the answer is unknown
//    and nothing is shown: nobody is locked out by a failed read.
//    With the flag false the gate component is never mounted and no row is read.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Button } from '@/components/ui';
import { useSheetDialogScope } from '@/components/ui/Sheet';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { TERMS_REACCEPT_ENABLED } from '@/constants/featureFlags';
import { useAuth } from '@/contexts/AuthContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useLegalCopy } from '@/hooks/useLegalCopy';
import {
  PRIVACY_URL,
  TERMS_URL,
  flushLegalAcceptances,
  readReacceptState,
  recordReacceptance,
  setLegalBuildInfo,
  type ReacceptState,
} from '@/utils/legalAcceptance';
import { shouldShowReaccept } from '@/utils/legalAcceptanceCore';

function appVersion(): string | null {
  try { return Constants.expoConfig?.version ?? Constants.nativeApplicationVersion ?? null; } catch { return null; }
}

// The over-the-air update this phone is running (expo-updates' update id), or
// null for the bundle built into the binary, for web and for a dev build.
// Lazy require inside a try, the way app/(tabs)/settings reads it: the module
// binds a native object that is absent on web and in tests.
function otaUpdateId(): string | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Updates = require('expo-updates') as { updateId?: string | null };
    return typeof Updates.updateId === 'string' && Updates.updateId.length > 0 ? Updates.updateId : null;
  } catch {
    return null;
  }
}

function ReacceptGate({ userId }: { userId: string }) {
  const styles = useThemedStyles(makeStyles);
  const copy = useLegalCopy();
  const { logout } = useAuth();
  const [state, setState] = useState<ReacceptState>('unknown');
  // Set by the tap: the person agreed on this phone. The sheet closes at once;
  // the record is sent now, or later if there is no signal.
  const [agreedHere, setAgreedHere] = useState(false);
  const [busy, setBusy] = useState<'agree' | 'out' | null>(null);
  const userRef = useRef(userId);
  userRef.current = userId;

  useEffect(() => {
    let cancelled = false;
    setState('unknown');
    setAgreedHere(false);
    void readReacceptState(userId).then((s) => { if (!cancelled && userRef.current === userId) setState(s); });
    return () => { cancelled = true; };
  }, [userId]);

  const agree = useCallback(async () => {
    if (busy) return;
    setBusy('agree');
    // Never rejects. The local note is written before the send is tried.
    await recordReacceptance(userId);
    setAgreedHere(true);
    setBusy(null);
  }, [busy, userId]);

  const signOut = useCallback(async () => {
    if (busy) return;
    setBusy('out');
    try { await logout(); } catch { /* the sheet stays; the person can try again */ }
    setBusy(null);
  }, [busy, logout]);

  const open = (url: string) => { Linking.openURL(url).catch(() => { /* the sheet stays up either way */ }); };

  const visible = shouldShowReaccept(TERMS_REACCEPT_ENABLED, userId, state) && !agreedHere;
  // While the sheet is up, the page's keyboard shortcuts behind it are silent (desktop web).
  useSheetDialogScope(visible);
  if (!visible) return null;
  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={() => { /* no dismiss: agree or sign out */ }} testID="legal-reaccept">
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title} accessibilityRole="header">{copy.reacceptTitle}</Text>
          <Text style={styles.body}>{copy.reacceptBody}</Text>
          <Text style={styles.heading}>{copy.changedHeadingLabel}</Text>
          {copy.changedLines.map((line) => (
            <Text key={line} style={styles.body}>{line}</Text>
          ))}
          <View style={styles.links}>
            <Button label={copy.termsLinkLabel} variant="secondary" onPress={() => open(TERMS_URL)} testID="legal-reaccept-terms" />
            <Button label={copy.privacyLinkLabel} variant="secondary" onPress={() => open(PRIVACY_URL)} testID="legal-reaccept-privacy" />
          </View>
          <Text style={styles.note}>{copy.agreeBody}</Text>
          <View style={styles.actions}>
            <Button label={copy.agreeLabel} variant="primary" onPress={() => { void agree(); }} loading={busy === 'agree'} disabled={busy === 'out'} testID="legal-reaccept-agree" />
            <Button label={copy.signOutLabel} variant="secondary" onPress={() => { void signOut(); }} loading={busy === 'out'} disabled={busy === 'agree'} testID="legal-reaccept-signout" />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function LegalGateHost() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const userIdRef = useRef<string | null>(userId);
  userIdRef.current = userId;

  useEffect(() => {
    setLegalBuildInfo({ appVersion: appVersion(), updateId: otaUpdateId(), platform: Platform.OS });
  }, []);

  // What this account still owes: at start, at a change of account, at foreground.
  useEffect(() => {
    if (!userId) return;
    void flushLegalAcceptances(userId);
  }, [userId]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && userIdRef.current) void flushLegalAcceptances(userIdRef.current);
    });
    return () => sub.remove();
  }, []);

  // Off: the gate is never mounted, nothing is read, nobody is asked or blocked.
  if (!TERMS_REACCEPT_ENABLED || !userId) return null;
  return <ReacceptGate userId={userId} />;
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.bg },
  content: { padding: Tokens.spacing.lg, paddingTop: Tokens.spacing.xl * 2, gap: Tokens.spacing.sm, maxWidth: 560, width: '100%', alignSelf: 'center' },
  title: { ...Type.title2, color: t.text },
  heading: { ...Type.headline, color: t.text, marginTop: Tokens.spacing.sm },
  body: { ...Type.body, color: t.textSecondary },
  note: { ...Type.footnote, color: t.textSecondary, marginTop: Tokens.spacing.sm },
  links: { gap: Tokens.spacing.xs, marginTop: Tokens.spacing.xs },
  actions: { gap: Tokens.spacing.xs, marginTop: Tokens.spacing.xs },
});
