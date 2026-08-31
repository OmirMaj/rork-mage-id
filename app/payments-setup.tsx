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
//   2. Tap CTA: kick off connect-onboarding, then open the returned URL.
//      On NATIVE that's an in-app browser via expo-web-browser; on WEB
//      it's a new tab (see handleStart — expo-web-browser's web shim
//      does not wait for dismissal, so the native post-flight poll is
//      wrong there). We pass our app's payments-setup deep link as both
//      returnUrl and refreshUrl.
//   3. Native: when the in-app browser closes (user finishes or bails),
//      we re-poll status. Web: the returnUrl round-trip re-mounts this
//      screen and polls, and the focus/visibilitychange listener re-polls
//      the original tab. If charges_enabled, switch to the Connected card.
//   4. If status is 'pending' (submitted but not yet enabled),
//      show a soft "Stripe is reviewing your info — usually <1h"
//      with a Refresh button.
//   5. If 'connected', show a simple confirmation + a "Manage on
//      Stripe" link that opens Stripe's dashboard.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Linking, ActivityIndicator, TextInput, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, CheckCircle2, Clock, AlertTriangle, Wallet, Lock,
  ExternalLink, RefreshCw,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useFinancingReferrals } from '@/hooks/useFinancingReferrals';
import { financingDisclosure } from '@/utils/financing';
import type { FinancingConfig } from '@/types';
import {
  startStripeConnectOnboarding, fetchStripeConnectStatus, type ConnectStatus,
} from '@/utils/stripeConnect';
import { nailIt } from '@/components/animations/NailItToast';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

export default function PaymentsSetupScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { user } = useAuth();
  const { settings, updateSettings } = useProjects();

  const [status, setStatus] = useState<ConnectStatus>('none');
  const [loading, setLoading] = useState<boolean>(true);
  const [starting, setStarting] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [accountId, setAccountId] = useState<string | undefined>(undefined);

  const fin = settings?.financing;
  const referralStats = useFinancingReferrals(user?.id).counts;
  const [finEnabled, setFinEnabled] = useState<boolean>(!!fin?.enabled);
  const [finPartner, setFinPartner] = useState<string>(fin?.partnerName ?? '');
  const [finUrl, setFinUrl] = useState<string>(fin?.prequalBaseUrl ?? '');
  const [finRefCode, setFinRefCode] = useState<string>(fin?.gcRefCode ?? '');
  const [finApr, setFinApr] = useState<string>(fin?.exampleApr != null ? String(fin.exampleApr) : '');
  const [finTerm, setFinTerm] = useState<string>(fin?.exampleTermMonths != null ? String(fin.exampleTermMonths) : '');

  const saveFinancing = useCallback((enabled: boolean) => {
    const url = finUrl.trim();
    if (enabled && !/^https:\/\//i.test(url)) {
      showAlert('Invalid URL', "The partner's prequalification link must start with https://.");
      return;
    }
    if (finApr.trim() && !Number.isFinite(Number(finApr))) {
      showAlert('Invalid number', 'Example APR must be a number (e.g. 9.99).');
      return;
    }
    if (finTerm.trim() && !Number.isFinite(Number(finTerm))) {
      showAlert('Invalid number', 'Example term must be a whole number of months (e.g. 60).');
      return;
    }
    const cfg: FinancingConfig = {
      enabled,
      partnerName: finPartner.trim(),
      prequalBaseUrl: url,
      gcRefCode: finRefCode.trim() || undefined,
      exampleApr: finApr.trim() ? Number(finApr) : undefined,
      exampleTermMonths: finTerm.trim() ? Number(finTerm) : undefined,
      updatedAt: new Date().toISOString(),
    };
    updateSettings({ financing: cfg });
    setFinEnabled(enabled);
  }, [finUrl, finPartner, finRefCode, finApr, finTerm, updateSettings]);

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

  // Web only — re-poll Stripe when the user comes back to this tab.
  //
  // On native, openBrowserAsync resolves when the in-app browser is
  // dismissed, so handleStart can poll straight after it. On web there is
  // no such moment: Stripe onboarding happens in a different tab entirely
  // and expo-web-browser's web shim resolves the instant the tab opens.
  // Without this listener the original tab keeps showing "not connected"
  // long after onboarding finished, until the user thinks to hit Refresh.
  // Silent so it never flashes the header spinner; stops once connected
  // so we're not calling connect-status on every tab switch forever.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (status === 'connected') return;
    const onFocus = () => { void refresh(true); };
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh, status]);

  const handleStart = useCallback(async () => {
    if (!user?.id || !user?.email) {
      showAlert('Sign In Required', 'Please sign in to set up payments.');
      return;
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStarting(true);
    try {
      // Stripe's account_links API requires HTTPS URLs and rejects custom
      // schemes (mageid://, exp://). We point it at the web build of the
      // app at app.mageid.app/payments-setup which renders the same React
      // component. On NATIVE, the redirect lands while the user is still
      // inside the in-app browser (SafariViewController / Chrome Custom
      // Tabs); they close it, our openBrowserAsync call returns, and that
      // triggers the post-flight status re-poll below. On WEB there is no
      // such dismissal event (see the web branch after this call), so the
      // redirect itself re-mounts this screen and polls on mount.
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
        showAlert('Could Not Start Setup', res.error ?? 'Stripe is unreachable.');
        return;
      }

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        // Audit #26 — web must NOT await-then-poll.
        //
        // expo-web-browser's web implementation is literally
        // `window.open(url, name, features); return { type: 'opened' }`
        // (node_modules/expo-web-browser/build/ExpoWebBrowser.web.js) — it
        // resolves the moment the tab opens, unlike SafariViewController /
        // Custom Tabs on native which resolve on dismissal. The old code
        // treated the two the same, so on web the post-flight poll ran
        // within the same second: connect-onboarding has by then written
        // stripe_account_id with charges_enabled=false, connect-status
        // derives that as 'incomplete', and the contractor was told
        // "Setup Not Finished" about a flow whose first page they hadn't
        // even read yet. Worse, that early poll was the only one, so a
        // user who DID finish in the other tab stayed stuck on the
        // not-connected card. Open and get out of the way — the returnUrl
        // (?return=1) round-trip re-mounts this screen and polls, and the
        // focus/visibilitychange effect above re-polls this tab.
        //
        // We call window.open ourselves rather than openBrowserAsync so we
        // get a full tab instead of the shim's 500x650 popup (Stripe's KYC
        // forms and document upload are miserable in a popup) and so we can
        // see a null handle, which means the browser blocked it — Safari
        // drops the click's transient activation across the awaited
        // connect-onboarding fetch above. Same-tab navigation is never
        // blocked, and returnUrl brings them right back here. No
        // `noopener`: it forces window.open to return null, which would
        // destroy that popup-blocked signal; the target is Stripe's own
        // hosted page.
        const opened = window.open(res.url, '_blank');
        if (!opened) window.location.assign(res.url);
        return;
      }

      // Native — open Stripe's hosted onboarding in an in-app browser.
      // Returns when the user closes it OR returnUrl fires.
      const result = await WebBrowser.openBrowserAsync(res.url, {
        dismissButtonStyle: 'close',
        toolbarColor: themeColors.surface,
        controlsColor: themeColors.accent,
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
        showAlert(
          'Setup Not Finished',
          'You can come back any time and pick up where you left off.',
        );
      }
    } catch (err) {
      console.error('[PaymentsSetup] start failed:', err);
      showAlert('Setup Failed', 'Please try again.');
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
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} testID="payments-setup-back" accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Payments</Text>
        <TouchableOpacity onPress={() => refresh()} style={styles.headerBtn} disabled={refreshing} testID="payments-setup-refresh">
          {refreshing ? (
            <ActivityIndicator size="small" color={themeColors.accent} />
          ) : (
            <RefreshCw size={18} color={themeColors.accent} strokeWidth={1.75} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView {...fabScroll} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={themeColors.accent} />
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

        <View style={styles.card}>
          <Text style={styles.heroTitle}>Client financing</Text>
          <Text style={styles.heroSub}>
            Let homeowners pay monthly through a third-party partner — you're paid in full upfront.
          </Text>

          <View style={styles.finRow}>
            <Text style={styles.heroSub}>Offer financing on estimates & invoices</Text>
            <Switch value={finEnabled} onValueChange={(v) => saveFinancing(v)} trackColor={{ false: themeColors.line, true: themeColors.accent }} thumbColor="#FFFFFF" testID="financing-enable" />
          </View>

          <TextInput style={styles.finInput} value={finPartner} onChangeText={setFinPartner}
            placeholder="Partner name (e.g. Wisetack)" placeholderTextColor="#9AA3AD" />
          <TextInput style={styles.finInput} value={finUrl} onChangeText={setFinUrl}
            placeholder="https://partner.com/prequalify" autoCapitalize="none" keyboardType="url" placeholderTextColor="#9AA3AD" />
          <TextInput style={styles.finInput} value={finRefCode} onChangeText={setFinRefCode}
            placeholder="Your partner referral code (optional)" autoCapitalize="none" placeholderTextColor="#9AA3AD" />
          <View style={styles.finAprRow}>
            <TextInput style={[styles.finInput, { flex: 1 }]} value={finApr} onChangeText={setFinApr}
              placeholder="Example APR % (optional)" keyboardType="decimal-pad" placeholderTextColor="#9AA3AD" />
            <TextInput style={[styles.finInput, { flex: 1 }]} value={finTerm} onChangeText={setFinTerm}
              placeholder="Example term (months)" keyboardType="number-pad" placeholderTextColor="#9AA3AD" />
          </View>

          <TouchableOpacity style={styles.cta} onPress={() => saveFinancing(finEnabled)} testID="financing-save">
            <Text style={styles.ctaText}>Save financing settings</Text>
          </TouchableOpacity>

          <Text style={styles.finDisclosure}>
            {finPartner.trim() ? financingDisclosure({
              enabled: finEnabled, partnerName: finPartner.trim(), prequalBaseUrl: finUrl, updatedAt: '',
            }) : 'Configure a partner to see the client disclosure that will appear on every offer.'}
          </Text>
          {finEnabled && (
            <Text style={styles.finStats}>
              Referrals: {referralStats.created} created · {referralStats.clicked} clicked · {referralStats.funded} funded
            </Text>
          )}
        </View>

        <View style={styles.fineprint}>
          <Lock size={11} color={themeColors.textMuted} strokeWidth={1.75} />
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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.card}>
      <View style={[styles.heroIcon, { backgroundColor: themeColors.accent + '15' }]}>
        <Wallet size={28} color={themeColors.accent} strokeWidth={1.75} />
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
            <MageAIMark size={16} color="#fff" />
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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.card}>
      <View style={[styles.heroIcon, { backgroundColor: Colors.warning + '15' }]}>
        <Clock size={28} color={Colors.warning} strokeWidth={1.75} />
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
            <RefreshCw size={16} color="#fff" strokeWidth={1.75} />
            <Text style={styles.ctaText}>Check status</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

function ConnectedCard({ accountId, onManage }: { accountId?: string; onManage: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.card}>
      <View style={[styles.heroIcon, { backgroundColor: themeColors.success + '15' }]}>
        <CheckCircle2 size={28} color={themeColors.success} strokeWidth={1.75} />
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
        style={[styles.cta, { backgroundColor: themeColors.accent }]}
        onPress={onManage}
        activeOpacity={0.85}
      >
        <ExternalLink size={16} color="#fff" strokeWidth={1.75} />
        <Text style={styles.ctaText}>Manage on Stripe</Text>
      </TouchableOpacity>
    </View>
  );
}

function Benefit({ text }: { text: string }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.benefitRow}>
      <View style={styles.benefitDot}>
        <CheckCircle2 size={14} color={themeColors.success} strokeWidth={1.75} />
      </View>
      <Text style={styles.benefitText}>{text}</Text>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerTitle: { ...Type.serifHeadline, color: t.text },
  loadingWrap: { paddingTop: 80, alignItems: 'center' as const },
  card: {
    margin: 16,
    backgroundColor: t.surface,
    borderRadius: 20,
    padding: 22,
    gap: 14,
    borderWidth: 1,
    borderColor: t.line,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: Tokens.radius.panel,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.5 },
  heroSub: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, lineHeight: 20 },
  benefits: { gap: 10, marginTop: 4 },
  benefitRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  benefitDot: {
    width: 24,
    height: 24,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.success + '15',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  benefitText: { flex: 1, fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '500' as const },
  cta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: t.accentFill,
    paddingVertical: 14,
    borderRadius: Tokens.radius.lg,
    marginTop: 8,
    shadowColor: t.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 3,
  },
  ctaText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: t.surface, letterSpacing: 0.2 },
  incompleteHint: { fontSize: Type.caption1.fontSize, color: t.textMuted, textAlign: 'center' as const, marginTop: 4 },
  brandHint: { fontSize: Type.caption1.fontSize, color: t.textMuted, textAlign: 'center' as const, marginTop: 4 },
  brandHintBold: { fontWeight: '700' as const, color: t.text },
  statRow: { flexDirection: 'row' as const, gap: 10, marginTop: 4 },
  stat: { flex: 1, backgroundColor: Colors.surfaceAlt, borderRadius: Tokens.radius.card, padding: 12, gap: 4 },
  statLabel: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: t.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' as const },
  statValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  fineprint: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 6,
    marginHorizontal: 28,
    marginTop: 8,
  },
  fineprintText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 16 },
  finInput: {
    backgroundColor: t.bg,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
  },
  finRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginTop: Tokens.spacing.sm,
  },
  finAprRow: { flexDirection: 'row' as const, gap: Tokens.spacing.xs },
  finDisclosure: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 10 },
  finStats: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 8 },
});
