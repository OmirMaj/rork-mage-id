// account-security.tsx — MFA / two-factor authentication enrollment
// for owner accounts. Builds on Supabase's built-in MFA primitives:
//   supabase.auth.mfa.enroll({ factorType: 'totp' })
//   supabase.auth.mfa.challengeAndVerify({ factorId, code })
//   supabase.auth.mfa.listFactors()
//   supabase.auth.mfa.unenroll({ factorId })
//
// Pre-fix the auth surface was email + password + magic link, with
// no second factor option. Owner accounts at $79+/mo SaaS are
// expected to support MFA — every PM/CFO compliance review asks
// about it.
//
// Flow:
//   1. Tap "Enable 2FA" → enroll() returns { factorId, totp.uri }.
//   2. We show the otpauth:// URI as a copy-able string + a button
//      that opens it in the user's default authenticator app
//      (Google / Authy / 1Password / Apple Passwords all register
//      the otpauth scheme).
//   3. User enters the 6-digit code from their app.
//   4. challengeAndVerify() with the code → factor becomes verified.
//      From now on every login requires this factor.
//
// Recovery:
//   - Tap "Disable 2FA" on a verified factor to unenroll. Requires
//     the user be signed in already (Supabase enforces re-auth on
//     unenroll out of the box).
//   - Lost-phone recovery is via the email magic-link flow (which
//     bypasses MFA when configured at the project level — that's a
//     conscious trade-off for residential GCs whose authenticator
//     phones break / get stolen frequently in the field).

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, ActivityIndicator,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import {
  Shield, ShieldCheck, KeyRound, ExternalLink, Copy, Check, AlertTriangle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface PendingEnrollment {
  factorId: string;
  uri: string;
  secret: string;
}

interface VerifiedFactor {
  id: string;
  friendlyName?: string;
  factorType: string;
  status: string;
}

export default function AccountSecurityScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [factors, setFactors] = useState<VerifiedFactor[]>([]);
  const [pending, setPending] = useState<PendingEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [enrolling, setEnrolling] = useState(false);

  const refreshFactors = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) {
        console.log('[mfa] listFactors error', error.message);
        setFactors([]);
        return;
      }
      // Only TOTP factors verified status — pending un-finished
      // enrollments shouldn't surface as "active 2FA."
      const verified = (data?.totp ?? []).filter(f => f.status === 'verified');
      setFactors(verified.map(f => ({
        id: f.id,
        friendlyName: f.friendly_name ?? undefined,
        factorType: f.factor_type,
        status: f.status,
      })));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshFactors();
  }, [refreshFactors]);

  const handleEnroll = useCallback(async () => {
    setEnrolling(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        // Friendly name appears in the user's authenticator app card
        // ("MAGE ID — omirmajeed@…"). Helps distinguish from any
        // other otpauth: entries on the device.
        friendlyName: `MAGE ID${user?.email ? ` — ${user.email}` : ''}`,
      });
      if (error) {
        Alert.alert('Could not start 2FA setup', error.message);
        return;
      }
      if (!data?.id || !data?.totp?.uri) {
        Alert.alert('Could not start 2FA setup', 'The server did not return a setup URI. Try again.');
        return;
      }
      setPending({
        factorId: data.id,
        uri: data.totp.uri,
        secret: data.totp.secret,
      });
    } catch (err) {
      Alert.alert('Could not start 2FA setup', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setEnrolling(false);
    }
  }, [user?.email]);

  const handleVerify = useCallback(async () => {
    if (!pending) return;
    if (!/^\d{6}$/.test(code.trim())) {
      Alert.alert('Code must be 6 digits', 'Enter the 6-digit code from your authenticator app.');
      return;
    }
    setVerifying(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: pending.factorId,
        code: code.trim(),
      });
      if (error) {
        Alert.alert('Code did not match', error.message);
        return;
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Two-factor enabled', 'You\'ll be asked for a code from your authenticator app on every sign-in.');
      setPending(null);
      setCode('');
      await refreshFactors();
    } finally {
      setVerifying(false);
    }
  }, [pending, code, refreshFactors]);

  const handleUnenroll = useCallback((factorId: string) => {
    Alert.alert(
      'Disable two-factor?',
      'Your account will only be protected by your password + magic link after this. We don\'t recommend disabling unless you\'re switching authenticator apps.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disable',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.auth.mfa.unenroll({ factorId });
            if (error) {
              Alert.alert('Could not disable 2FA', error.message);
              return;
            }
            await refreshFactors();
          },
        },
      ],
    );
  }, [refreshFactors]);

  const handleOpenInAuthenticator = useCallback(async () => {
    if (!pending) return;
    try {
      // otpauth:// is a registered URL scheme on iOS/Android for
      // authenticator apps. The system picker offers Google
      // Authenticator / 1Password / Authy / Apple Passwords if any
      // are installed. If none are installed Linking.openURL fails
      // and we fall through to clipboard copy.
      await Linking.openURL(pending.uri);
    } catch {
      try {
        await Clipboard.setStringAsync(pending.secret);
        Alert.alert('Secret copied', 'No authenticator app is installed. We copied the secret to your clipboard — paste it into Google Authenticator, Authy, or 1Password.');
      } catch {
        Alert.alert('Cannot open', 'Could not open an authenticator app. Copy the secret below into your authenticator app manually.');
      }
    }
  }, [pending]);

  const handleCopySecret = useCallback(async () => {
    if (!pending) return;
    try {
      await Clipboard.setStringAsync(pending.secret);
      if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
      Alert.alert('Copied', 'Paste this into your authenticator app.');
    } catch {}
  }, [pending]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Account Security', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.primary, headerTitleStyle: { fontWeight: '700' as const, color: Colors.text } }} />
      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        <View style={styles.headerWrap}>
          <Shield size={28} color={Colors.primary} />
          <Text style={styles.headerTitle}>Two-Factor Authentication</Text>
          <Text style={styles.headerSub}>
            Protect your account with a code from your authenticator app on every sign-in.
          </Text>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : pending ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Step 2 — Verify your code</Text>
            <Text style={styles.cardSub}>
              Open your authenticator app and enter the 6-digit code shown for &quot;MAGE ID&quot;.
            </Text>
            <TouchableOpacity style={styles.actionBtn} onPress={handleOpenInAuthenticator} activeOpacity={0.85}>
              <ExternalLink size={14} color={Colors.textOnPrimary} />
              <Text style={styles.actionBtnText}>Open in authenticator app</Text>
            </TouchableOpacity>
            <View style={styles.secretRow}>
              <Text style={styles.secretLabel}>Or paste this secret manually:</Text>
              <TouchableOpacity style={styles.secretBox} onPress={handleCopySecret} activeOpacity={0.7}>
                <Text style={styles.secretText} selectable>{pending.secret}</Text>
                <Copy size={14} color={Colors.primary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.codeLabel}>6-digit code</Text>
            <TextInput
              style={styles.codeInput}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="123456"
              placeholderTextColor={Colors.textMuted}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionSecondary]}
                onPress={() => { setPending(null); setCode(''); }}
                activeOpacity={0.7}
                disabled={verifying}
              >
                <Text style={[styles.actionBtnText, { color: Colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { flex: 1.2 }]}
                onPress={handleVerify}
                activeOpacity={0.85}
                disabled={verifying || code.length !== 6}
                accessibilityRole="button"
                testID="mfa-verify-btn"
              >
                {verifying ? <ActivityIndicator color={Colors.textOnPrimary} /> : <Check size={14} color={Colors.textOnPrimary} />}
                <Text style={styles.actionBtnText}>Verify</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : factors.length > 0 ? (
          <>
            <View style={[styles.card, { borderColor: Colors.success + '40', backgroundColor: Colors.success + '08' }]}>
              <View style={styles.inlineRow}>
                <ShieldCheck size={20} color={Colors.success} />
                <Text style={[styles.cardTitle, { color: Colors.success }]}>Two-factor enabled</Text>
              </View>
              <Text style={styles.cardSub}>
                Your account is protected. You&apos;ll be asked for a 6-digit code on every sign-in.
              </Text>
            </View>
            {factors.map(f => (
              <View key={f.id} style={styles.factorRow}>
                <KeyRound size={14} color={Colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.factorName}>{f.friendlyName ?? 'TOTP authenticator'}</Text>
                  <Text style={styles.factorMeta}>{f.factorType.toUpperCase()} · {f.status}</Text>
                </View>
                <TouchableOpacity
                  style={styles.unenrollBtn}
                  onPress={() => handleUnenroll(f.id)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                >
                  <Text style={styles.unenrollBtnText}>Disable</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Step 1 — Get an authenticator app</Text>
            <Text style={styles.cardSub}>
              Install one of these on your phone if you haven&apos;t already. They generate a 6-digit code that changes every 30 seconds.
            </Text>
            <View style={styles.appsRow}>
              {[
                { name: 'Google Authenticator', uri: 'https://apps.apple.com/app/id388497605' },
                { name: '1Password', uri: 'https://apps.apple.com/app/id568903335' },
                { name: 'Authy', uri: 'https://apps.apple.com/app/id494168017' },
              ].map(app => (
                <TouchableOpacity
                  key={app.name}
                  style={styles.appChip}
                  onPress={() => Linking.openURL(app.uri).catch(() => {})}
                  activeOpacity={0.7}
                >
                  <Text style={styles.appChipText}>{app.name}</Text>
                  <ExternalLink size={10} color={Colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.actionBtn, { marginTop: 8 }]}
              onPress={handleEnroll}
              activeOpacity={0.85}
              disabled={enrolling}
              accessibilityRole="button"
              testID="mfa-enroll-btn"
            >
              {enrolling ? <ActivityIndicator color={Colors.textOnPrimary} /> : <Shield size={14} color={Colors.textOnPrimary} />}
              <Text style={styles.actionBtnText}>Enable two-factor</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.footer}>
          <AlertTriangle size={12} color={Colors.textMuted} />
          <Text style={styles.footerText}>
            If you lose access to your authenticator app, you can still sign in via the email magic-link flow. Email recovery doesn&apos;t require the 2FA code, so keep your email account secure too.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerWrap: { alignItems: 'center' as const, paddingHorizontal: 24, paddingVertical: 20, gap: 6 },
  headerTitle: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.4, marginTop: 4 },
  headerSub: { fontSize: Type.footnote.fontSize, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 18 },

  loadingWrap: { paddingVertical: 32, alignItems: 'center' as const },

  card: { backgroundColor: Colors.surface, marginHorizontal: 16, padding: 16, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: Colors.borderLight, gap: 8, marginBottom: 12 },
  cardTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.text },
  cardSub: { fontSize: Type.caption1.fontSize, color: Colors.textSecondary, lineHeight: 18 },
  inlineRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },

  appsRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6, marginTop: 8 },
  appChip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: Colors.fillTertiary },
  appChipText: { fontSize: Type.caption2.fontSize, color: Colors.text, fontWeight: '600' as const },

  actionBtn: { flex: 1, minHeight: 44, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, backgroundColor: Colors.primary, borderRadius: Tokens.radius.lg, paddingHorizontal: 14 },
  actionBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.textOnPrimary },
  actionSecondary: { backgroundColor: Colors.fillTertiary },

  secretRow: { gap: 6, marginTop: 4 },
  secretLabel: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, fontWeight: '600' as const },
  secretBox: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, padding: 10, backgroundColor: Colors.fillTertiary, borderRadius: Tokens.radius.sm },
  secretText: { fontSize: Type.footnote.fontSize, color: Colors.text, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', flex: 1 },

  codeLabel: { fontSize: Type.caption1.fontSize, color: Colors.textSecondary, fontWeight: '600' as const, marginTop: 8 },
  codeInput: {
    minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 14, fontSize: Type.title3.fontSize, color: Colors.text, letterSpacing: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  factorRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, marginHorizontal: 16, padding: 12, borderRadius: Tokens.radius.lg, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderLight, marginBottom: 8 },
  factorName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.text },
  factorMeta: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: 2 },
  unenrollBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Tokens.radius.sm, backgroundColor: Colors.error + '14' },
  unenrollBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: Colors.error },

  footer: { flexDirection: 'row' as const, gap: 8, alignItems: 'flex-start' as const, paddingHorizontal: 18, paddingVertical: 16, opacity: 0.7 },
  footerText: { flex: 1, fontSize: Type.caption2.fontSize, color: Colors.textMuted, lineHeight: 14 },
});
