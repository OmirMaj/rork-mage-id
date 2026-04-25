// app/payments-setup.tsx — Stripe Connect onboarding screen.
//
// This is where a GC clicks "Set up payments" and gets bounced through
// Stripe's hosted Express onboarding. After Stripe redirects back,
// the screen polls connect-status and shows a connected/pending state.
//
// UX flow:
//   1. First open: shows the value prop ("Get paid faster — clients
//      pay invoices in one tap, money lands in your bank") + a big
//      "Set up payments" CTA. Disabled while we fetch status.
//   2. Tap CTA: kick off connect-onboarding, open the returned URL
//      in an in-app browser via expo-web-browser. We pass our app's
//      payments-setup deep link as both returnUrl and refreshUrl.
//   3. When the in-app browser closes (user finishes or bails),
//      we re-poll status. If charges_enabled, switch to the
//      Connected card.
//   4. If status is 'pending' (submitted but not yet enabled),
//      show a soft "Stripe is reviewing your info — usually <1h"
//      with a Refresh button.
//   5. If 'connected', show a simple confirmation + a "Manage on
//      Stripe" link that opens Stripe's dashboard.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Alert, Linking, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, CheckCircle2, Clock, AlertTriangle, Wallet, Lock,
  ExternalLink, RefreshCw, Sparkles,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import {
  startStripeConnectOnboarding, fetchStripeConnectStatus, type ConnectStatus,
} from '@/utils/stripeConnect';
import { nailIt } from '@/components/animations/NailItToast';

export default function PaymentsSetupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { settings } = useProjects();

  const [status, setStatus] = useState<ConnectStatus>('none');
  const [loading, setLoading] = useState<boolean>(true);
  const [starting, setStarting] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [accountId, setAccountId] = useState<string | undefined>(undefined);

  const refresh = useCallback(async (silent = false) => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    if (!silent) setRefreshing(true);
    const res = await fetchStripeConnectStatus(user.id);
    if (res.success) {
      setStatus(res.status ?? 'none');
      setAccountId(res.accountId);
    }
    setLoading(false);
    if (!silent) setRefreshing(false);
  }, [user?.id]);

  useEffect(() => {
    refresh(true);
  }, [refresh]);

  const handleStart = useCallback(async () => {
    if (!user?.id || !user?.email) {
      Alert.alert('Sign In Required', 'Please sign in to set up payments.');
      return;
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStarting(true);
    try {
      // Stripe's account_links API requires HTTPS URLs and rejects custom
      // schemes (mageid://, exp://). We point it at the web build of the
      // app at app.mageid.app/payments-setup which renders the same React
      // component. After the redirect lands there, the user is still
      // inside the in-app browser (SafariViewController / Chrome Custom
      // Tabs); they close it and our openBrowserAsync call returns,
      // triggering the post-flight status re-poll below.
      const returnUrl = 'https://app.mageid.app/payments-setup?return=1';
      const refreshUrl = 'https://app.mageid.app/payments-setup?refresh=1';

      const res = await startStripeConnectOnboarding({
        userId: user.id,
        email: user.email,
        returnUrl,
        refreshUrl,
        companyName: settings?.branding?.companyName,
      });

      if (!res.success || !res.url) {
        if (res.alreadyEnabled) {
          await refresh();
          nailIt('Payments already connected');
          return;
        }
        Alert.alert('Could Not Start Setup', res.error ?? 'Stripe is unreachable.');
        return;
      }

      // Open Stripe's hosted onboarding in a system browser/in-app
      // browser. Returns when the user closes it OR returnUrl fires.
      const result = await WebBrowser.openBrowserAsync(res.url, {
        dismissButtonStyle: 'close',
        toolbarColor: Colors.surface,
        controlsColor: Colors.primary,
      });
      console.log('[PaymentsSetup] WebBrowser result:', result.type);

      // Re-poll status after the browser closes. The Stripe webhook
      // typically arrives within a second or two but we ALSO fetch the
      // live account here so the UI feels instant.
      await refresh();
      const post = await fetchStripeConnectStatus(user.id);
      if (post.status === 'connected') {
        nailIt('Payments connected');
      } else if (post.status === 'pending') {
        // No-op — we'll show the pending card.
      } else if (post.status === 'incomplete') {
        Alert.alert(
          'Setup Not Finished',
          'You can come back any time and pick up where you left off.',
        );
      }
    } catch (err) {
      console.error('[PaymentsSetup] start failed:', err);
      Alert.alert('Setup Failed', 'Please try again.');
    } finally {
      setStarting(false);
    }
  }, [user?.id, user?.email, settings?.branding?.companyName, refresh]);

  const handleManageOnStripe = useCallback(async () => {
    // Stripe Express dashboards are at https://connect.stripe.com/express.
    // For deep-linking to a specific account you'd typically generate a
    // login link from a server-side function — for v1 we just open the
    // Express dashboard root.
    const url = 'https://connect.stripe.com/express_login';
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      await Linking.openURL(url);
    }
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} testID="payments-setup-back">
          <ChevronLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payments</Text>
        <TouchableOpacity onPress={() => refresh()} style={styles.headerBtn} disabled={refreshing} testID="payments-setup-refresh">
          {refreshing ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <RefreshCw size={18} color={Colors.primary} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : status === 'connected' ? (
          <ConnectedCard accountId={accountId} onManage={handleManageOnStripe} />
        ) : status === 'pending' ? (
          <PendingCard onRefresh={() => refresh()} refreshing={refreshing} />
        ) : (
          <NotConnectedCard
            status={status}
            starting={starting}
            onStart={handleStart}
            companyName={settings?.branding?.companyName}
          />
        )}

        <View style={styles.fineprint}>
          <Lock size={11} color={Colors.textMuted} />
          <Text style={styles.fineprintText}>
            Secured by Stripe. MAGE ID never stores card data. A 1% platform fee plus standard
            Stripe processing (2.9% + 30¢) is deducted from each successful payment.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function NotConnectedCard({
  status, starting, onStart, companyName,
}: { status: ConnectStatus; starting: boolean; onStart: () => void; companyName?: string }) {
  return (
    <View style={styles.card}>
      <View style={[styles.heroIcon, { backgroundColor: Colors.primary + '15' }]}>
        <Wallet size={28} color={Colors.primary} />
      </View>
      <Text style={styles.heroTitle}>Get paid faster</Text>
      <Text style={styles.heroSub}>
        Connect your bank in 3 minutes. Clients tap "Pay" in your invoice email and the money
        lands in your account — no chasing checks.
      </Text>

      <View style={styles.benefits}>
        <Benefit text="One-tap card or bank pay on every invoice" />
        <Benefit text="Funds in your bank in 1–2 business days" />
        <Benefit text="Stripe handles compliance, KYC, and 1099-K tax docs" />
      </View>

      <TouchableOpacity
        style={[styles.cta, starting && { opacity: 0.7 }]}
        onPress={onStart}
        disabled={starting}
        activeOpacity={0.85}
        testID="start-stripe-connect"
      >
        {starting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Sparkles size={16} color="#fff" />
            <Text style={styles.ctaText}>
              {status === 'incomplete' ? 'Continue setup' : 'Set up payments'}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {status === 'incomplete' && (
        <Text style={styles.incompleteHint}>
          You started onboarding earlier — pick up where you left off.
        </Text>
      )}
      {companyName ? (
        <Text style={styles.brandHint}>
          Setting up for: <Text style={styles.brandHintBold}>{companyName}</Text>
        </Text>
      ) : null}
    </View>
  );
}

function PendingCard({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  return (
    <View style={styles.card}>
      <View style={[styles.heroIcon, { backgroundColor: Colors.warning + '15' }]}>
        <Clock size={28} color={Colors.warning} />
      </View>
      <Text style={styles.heroTitle}>Stripe is reviewing your info</Text>
      <Text style={styles.heroSub}>
        Your details have been submitted. Stripe usually verifies and enables payments within
        an hour, sometimes a few minutes. You'll get an email when it's done.
      </Text>
      <TouchableOpacity
        style={[styles.cta, { backgroundColor: Colors.warning }]}
        onPress={onRefresh}
        disabled={refreshing}
        activeOpacity={0.85}
      >
        {refreshing ? <ActivityIndicator color="#fff" /> : (
          <>
            <RefreshCw size={16} color="#fff" />
            <Text style={styles.ctaText}>Check status</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

function ConnectedCard({ accountId, onManage }: { accountId?: string; onManage: () => void }) {
  return (
    <View style={styles.card}>
      <View style={[styles.heroIcon, { backgroundColor: Colors.success + '15' }]}>
        <CheckCircle2 size={28} color={Colors.success} />
      </View>
      <Text style={styles.heroTitle}>Payments connected</Text>
      <Text style={styles.heroSub}>
        You're all set. Every invoice you send now includes a one-tap pay button. Money lands
        in your bank in 1–2 business days.
      </Text>

      <View style={styles.statRow}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Account ID</Text>
          <Text style={styles.statValue} numberOfLines={1}>
            {accountId ?? '—'}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Platform fee</Text>
          <Text style={styles.statValue}>1%</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.cta, { backgroundColor: Colors.primary }]}
        onPress={onManage}
        activeOpacity={0.85}
      >
        <ExternalLink size={16} color="#fff" />
        <Text style={styles.ctaText}>Manage on Stripe</Text>
      </TouchableOpacity>
    </View>
  );
}

function Benefit({ text }: { text: string }) {
  return (
    <View style={styles.benefitRow}>
      <View style={styles.benefitDot}>
        <CheckCircle2 size={14} color={Colors.success} />
      </View>
      <Text style={styles.benefitText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  loadingWrap: { paddingTop: 80, alignItems: 'center' as const },
  card: {
    margin: 16,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 22,
    gap: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  heroTitle: { fontSize: 22, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.5 },
  heroSub: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  benefits: { gap: 10, marginTop: 4 },
  benefitRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  benefitDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.success + '15',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  benefitText: { flex: 1, fontSize: 14, color: Colors.text, fontWeight: '500' as const },
  cta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 3,
  },
  ctaText: { fontSize: 16, fontWeight: '700' as const, color: '#FFFFFF', letterSpacing: 0.2 },
  incompleteHint: { fontSize: 12, color: Colors.textMuted, textAlign: 'center' as const, marginTop: 4 },
  brandHint: { fontSize: 12, color: Colors.textMuted, textAlign: 'center' as const, marginTop: 4 },
  brandHintBold: { fontWeight: '700' as const, color: Colors.text },
  statRow: { flexDirection: 'row' as const, gap: 10, marginTop: 4 },
  stat: { flex: 1, backgroundColor: Colors.surfaceAlt, borderRadius: 12, padding: 12, gap: 4 },
  statLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' as const },
  statValue: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  fineprint: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 6,
    marginHorizontal: 28,
    marginTop: 8,
  },
  fineprintText: { flex: 1, fontSize: 11, color: Colors.textMuted, lineHeight: 16 },
});
