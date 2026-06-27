import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Crown, Building2, CheckCircle2, X, Shield, Smartphone, Apple } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { track, AnalyticsEvents } from '@/utils/analytics';

// App Store / Play Store deep links — used by the web paywall to bounce
// users to mobile. App Store ID 6762229238 is from eas.json submit.production.
const IOS_APP_URL = 'https://apps.apple.com/app/id6762229238';
const ANDROID_APP_URL = 'https://play.google.com/store/apps/details?id=app.mageid.android';

type RequiredTier = 'pro' | 'business' | 'enterprise';
type BillingPeriod = 'monthly' | 'annual';

interface PaywallProps {
  visible: boolean;
  onClose: () => void;
  /** Display name of the feature the user tried to access, e.g. "Cash Flow Forecaster". */
  feature: string;
  /** Minimum tier required for this feature. */
  requiredTier: RequiredTier;
}

// Fallback prices shown when RevenueCat offerings haven't loaded yet or the
// store isn't available. These mirror the App Store Connect product prices.
// Enterprise's annual is capped at $999.99 — Apple's Tier 1500 maximum.
const FALLBACK_PRICES = {
  pro: { monthly: '$29.99', annual: '$289.99', annualMonthlyEquivalent: '$24.16' },
  business: { monthly: '$79.99', annual: '$769.99', annualMonthlyEquivalent: '$64.16' },
  enterprise: { monthly: '$149.99', annual: '$999.99', annualMonthlyEquivalent: '$83.33' },
} as const;

const PRO_BENEFITS: string[] = [
  'Unlimited projects and estimates',
  'Cash Flow Forecaster & Budget Health',
  'Schedule Maker with Gantt & PDF export',
  'Daily Field Reports with photos',
  'AI Code Check (20/day) & Voice-to-Report',
  'Client Portal for your customers',
  'Lien Waivers, Proposals, Change Orders',
  'Equipment tracking & Price Alerts',
];

const BUSINESS_BENEFITS: string[] = [
  'Everything in Pro, plus:',
  'Unlimited AI Code Checks & bid responses',
  'Time Tracking for crews',
  'Plan Viewer & markup tools',
  'Subcontractor management',
  'Punch List & Closeout packets',
  'RFIs, Submittals, and full Budget Dashboard',
];

const ENTERPRISE_BENEFITS: string[] = [
  'Everything in Business, plus:',
  'Highest AI usage caps in the app',
  '100 drawing analyses / month',
  '200 photo analyses / month',
  '4,500 text-AI calls / month',
  'Priority queue on heavy AI requests',
  'Concierge onboarding for the team',
];

export default function Paywall({ visible, onClose, feature, requiredTier }: PaywallProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<BillingPeriod>('annual');

  // ── Monetization funnel: top-of-funnel impression ──
  // Fires every time the modal becomes visible. Tagged with the feature
  // that triggered the gate + the tier blocked, so PostHog can split
  // funnels by which gate produces conversion.
  useEffect(() => {
    if (!visible) return;
    track(AnalyticsEvents.PAYWALL_VIEWED, { feature, tier_blocked: requiredTier });
  }, [visible, feature, requiredTier]);

  // Wrap every dismissal path so paywall_dismissed always fires.
  // Pair with paywall_viewed → bounce rate. Pair with started/completed
  // → conversion rate. Without this, every "user bailed" path is silent.
  const handleDismiss = useCallback(() => {
    track(AnalyticsEvents.PAYWALL_DISMISSED, { feature });
    onClose();
  }, [feature, onClose]);

  const {
    purchasePro,
    purchaseBusiness,
    purchaseEnterprise,
    proPackage,
    proAnnualPackage,
    businessPackage,
    businessAnnualPackage,
    enterprisePackage,
    enterpriseAnnualPackage,
    isPurchasing,
    isLoading,
  } = useSubscription();

  const tierLabel = requiredTier === 'enterprise' ? 'Enterprise'
    : requiredTier === 'business' ? 'Business'
    : 'Pro';
  const tierColor = requiredTier === 'enterprise' ? Colors.purple
    : requiredTier === 'business' ? themeColors.accent
    : themeColors.accent;
  const TierIcon = requiredTier === 'enterprise' ? Crown
    : requiredTier === 'business' ? Building2
    : Crown;
  const benefits = requiredTier === 'enterprise' ? ENTERPRISE_BENEFITS
    : requiredTier === 'business' ? BUSINESS_BENEFITS
    : PRO_BENEFITS;
  const fallback = FALLBACK_PRICES[requiredTier];

  const pricing = useMemo(() => {
    // Try to use live RevenueCat pricing; fall back to static amounts.
    const monthlyPkg = requiredTier === 'enterprise' ? enterprisePackage
      : requiredTier === 'business' ? businessPackage
      : proPackage;
    const annualPkg = requiredTier === 'enterprise' ? enterpriseAnnualPackage
      : requiredTier === 'business' ? businessAnnualPackage
      : proAnnualPackage;

    const monthlyPrice = monthlyPkg?.product?.priceString ?? fallback.monthly;
    const annualPrice = annualPkg?.product?.priceString ?? fallback.annual;

    // Compute annual "monthly equivalent" if we have live numbers.
    let monthlyEquivalent: string = fallback.annualMonthlyEquivalent;
    const annualCents = annualPkg?.product?.price;
    if (typeof annualCents === 'number' && annualCents > 0) {
      const perMonth = annualCents / 12;
      monthlyEquivalent = `$${perMonth.toFixed(2)}`;
    }

    return { monthlyPrice, annualPrice, monthlyEquivalent };
  }, [requiredTier, proPackage, proAnnualPackage, businessPackage, businessAnnualPackage, enterprisePackage, enterpriseAnnualPackage, fallback]);

  // Whether RevenueCat actually resolved a purchasable package for this
  // tier. When false (most common cause: the IAP product isn't set up /
  // approved in App Store Connect yet), tapping Upgrade is guaranteed to
  // fail — so we tell the user honestly instead of "try again" forever.
  const tierPackageAvailable = useMemo(() => {
    const monthlyPkg = requiredTier === 'enterprise' ? enterprisePackage
      : requiredTier === 'business' ? businessPackage
      : proPackage;
    const annualPkg = requiredTier === 'enterprise' ? enterpriseAnnualPackage
      : requiredTier === 'business' ? businessAnnualPackage
      : proAnnualPackage;
    return !!monthlyPkg || !!annualPkg;
  }, [requiredTier, proPackage, proAnnualPackage, businessPackage, businessAnnualPackage, enterprisePackage, enterpriseAnnualPackage]);

  const handleUpgrade = useCallback(async () => {
    // Funnel: intent event the moment the user taps Upgrade — fires
    // BEFORE Apple's native confirm sheet. Captures pricing curiosity
    // even when the user backs out of Apple's prompt. Pair with
    // subscription_purchased (success) / subscription_purchase_failed
    // for the bottom of the funnel.
    track(AnalyticsEvents.SUBSCRIPTION_PURCHASE_STARTED, { tier: requiredTier, period });
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (requiredTier === 'enterprise') {
        await purchaseEnterprise(period);
      } else if (requiredTier === 'business') {
        await purchaseBusiness(period);
      } else {
        await purchasePro(period);
      }
      track(AnalyticsEvents.SUBSCRIPTION_PURCHASED, { tier: requiredTier, period });
      Alert.alert(`Welcome to ${tierLabel}!`, 'Your subscription is now active.');
      onClose();
    } catch (err: unknown) {
      const isCancelled =
        err && typeof err === 'object' && 'userCancelled' in err && (err as { userCancelled: boolean }).userCancelled;
      if (isCancelled) {
        track(AnalyticsEvents.PAYWALL_DISMISSED, { feature, kind: 'apple_cancel' });
        return;
      }
      const errorKind = err instanceof Error ? err.name : 'unknown';
      track(AnalyticsEvents.SUBSCRIPTION_PURCHASE_FAILED, { tier: requiredTier, error_kind: errorKind });
      console.log('[Paywall modal] Purchase failed:', err);
      // Distinguish "this plan isn't purchasable yet" (config / store-
      // availability — retrying never helps) from a genuine payment
      // failure. The generic "try again" on an unconfigured product was
      // the bug: TestFlight surfaced Enterprise before its IAP product
      // was approved in App Store Connect, and the user got stuck in a
      // retry loop with no idea why.
      const rawMsg = err instanceof Error ? err.message : '';
      const isUnavailable =
        !tierPackageAvailable ||
        /not configured|not available|no packages|unavailable/i.test(rawMsg);
      if (isUnavailable) {
        Alert.alert(
          `${tierLabel} isn’t available yet`,
          `The ${tierLabel} plan isn’t purchasable on your device right now. This usually means the plan is still being set up in the App Store. Try a lower tier, or email support@mageid.app and we’ll sort it out.`,
        );
      } else {
        Alert.alert('Purchase Failed', 'Could not complete the purchase. Please try again.');
      }
    }
  }, [purchasePro, purchaseBusiness, purchaseEnterprise, requiredTier, period, tierLabel, feature, onClose, tierPackageAvailable]);

  // On web, we don't take subscription payments — we redirect users to the
  // mobile app where Apple/Google handle billing. The user's account tier
  // syncs via Supabase once they subscribe on iOS/Android, so when they
  // come back to the web app it'll already show as Pro/Business.
  // This avoids:
  //   • Maintaining RC web billing live keys
  //   • A second checkout flow that competes with the invoice Stripe flow
  //   • Confusing users about which payment surface unlocks what
  if (Platform.OS === 'web') {
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleDismiss}>
        <View style={[styles.container, { paddingBottom: insets.bottom }]}>
          <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
            <View style={{ width: 36 }} />
            <Text style={styles.headerTitle}>Continue on Mobile</Text>
            <TouchableOpacity onPress={handleDismiss} style={styles.closeBtn} testID="paywall-modal-close-web" accessibilityRole="button" accessibilityLabel="Close"><X size={22} color={themeColors.text} /></TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={[styles.heroIconWrap, { backgroundColor: tierColor + '15' }]}>
              <Smartphone size={36} color={tierColor} />
            </View>

            <Text style={styles.featureName}>{feature}</Text>
            <Text style={styles.requiresLine}>
              Requires <Text style={[styles.requiresTierEm, { color: tierColor }]}>{tierLabel}</Text>
            </Text>

            <Text style={styles.webExplain}>
              Subscriptions are managed in the MAGE ID mobile app. Once you upgrade
              there, your account will unlock {tierLabel} features everywhere —
              including back here on the web.
            </Text>

            <View style={styles.benefitsBox}>
              {benefits.map((b, idx) => (
                <View key={idx} style={styles.benefitRow}>
                  <CheckCircle2 size={16} color={tierColor} />
                  <Text style={styles.benefitText}>{b}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.upgradeBtn, { backgroundColor: '#0B0D10' }]}
              activeOpacity={0.85}
              onPress={() => {
                if (typeof window !== 'undefined') window.open(IOS_APP_URL, '_blank');
              }}
              testID="paywall-open-app-store"
            >
              <Apple size={18} color="#fff" />
              <Text style={styles.upgradeBtnText}>Open in App Store</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.upgradeBtn, { backgroundColor: '#0B0D10', marginTop: 10 }]}
              activeOpacity={0.85}
              onPress={() => {
                if (typeof window !== 'undefined') window.open(ANDROID_APP_URL, '_blank');
              }}
              testID="paywall-open-play-store"
            >
              <Smartphone size={18} color="#fff" />
              <Text style={styles.upgradeBtnText}>Open in Google Play</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleDismiss} style={styles.notNowBtn} testID="paywall-not-now-web">
              <Text style={styles.notNowText}>Maybe later</Text>
            </TouchableOpacity>

            <View style={styles.trustRow}>
              <Shield size={13} color={themeColors.textSecondary} />
              <Text style={styles.trustText}>
                Sign in on the mobile app with the same email and your subscription
                will sync to this account automatically.
              </Text>
            </View>
          </ScrollView>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleDismiss}>
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? 16 : insets.top + 8 }]}>
          <View style={{ width: 36 }} />
          <Text style={styles.headerTitle}>Upgrade Required</Text>
          <TouchableOpacity onPress={handleDismiss} style={styles.closeBtn} testID="paywall-modal-close" accessibilityRole="button" accessibilityLabel="Close"><X size={22} color={themeColors.text} /></TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={[styles.heroIconWrap, { backgroundColor: tierColor + '15' }]}>
            <TierIcon size={36} color={tierColor} />
          </View>

          <Text style={styles.featureName}>{feature}</Text>
          <Text style={styles.requiresLine}>
            Requires <Text style={[styles.requiresTierEm, { color: tierColor }]}>{tierLabel}</Text>
          </Text>

          <View style={styles.benefitsBox}>
            {benefits.map((b, idx) => (
              <View key={idx} style={styles.benefitRow}>
                <CheckCircle2 size={16} color={tierColor} />
                <Text style={styles.benefitText}>{b}</Text>
              </View>
            ))}
          </View>

          {/* Monthly / Annual toggle */}
          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[styles.toggleBtn, period === 'monthly' && styles.toggleBtnActive]}
              onPress={() => setPeriod('monthly')}
              activeOpacity={0.8}
              testID="paywall-period-monthly"
            >
              <Text style={[styles.toggleText, period === 'monthly' && styles.toggleTextActive]}>Monthly</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, period === 'annual' && styles.toggleBtnActive]}
              onPress={() => setPeriod('annual')}
              activeOpacity={0.8}
              testID="paywall-period-annual"
            >
              <Text style={[styles.toggleText, period === 'annual' && styles.toggleTextActive]}>Annual</Text>
              <View style={styles.saveBadge}>
                <Text style={styles.saveBadgeText}>Save 20%</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Price display */}
          <View style={styles.priceBox}>
            {period === 'monthly' ? (
              <>
                <Text style={styles.priceBig}>{pricing.monthlyPrice}</Text>
                <Text style={styles.priceSub}>per month, cancel anytime</Text>
              </>
            ) : (
              <>
                <Text style={styles.priceBig}>{pricing.monthlyEquivalent}/mo</Text>
                <Text style={styles.priceSub}>billed {pricing.annualPrice} annually</Text>
                {(() => {
                  // Compute the dollar value of annual savings vs paying
                  // monthly, when we have live pricing. Skipped on the
                  // fallback strings ("$X.XX/mo") which can't be parsed.
                  const monthlyCents = parseFloat(pricing.monthlyPrice.replace(/[^0-9.]/g, '')) * 100;
                  const annualCents = parseFloat(pricing.annualPrice.replace(/[^0-9.]/g, '')) * 100;
                  if (!Number.isFinite(monthlyCents) || !Number.isFinite(annualCents) || monthlyCents <= 0 || annualCents <= 0) return null;
                  const yearAtMonthlyCents = monthlyCents * 12;
                  const savingsCents = yearAtMonthlyCents - annualCents;
                  if (savingsCents <= 0) return null;
                  const savings = `$${(savingsCents / 100).toFixed(0)}`;
                  return (
                    <View style={styles.savingsRow}>
                      <Text style={styles.savingsRowText}>
                        Save <Text style={styles.savingsRowAmount}>{savings}</Text> vs. monthly
                      </Text>
                    </View>
                  );
                })()}
              </>
            )}
          </View>

          {/* When RC has loaded but this tier has no purchasable package
              (IAP not yet approved in App Store Connect), say so plainly
              instead of letting the user tap into a guaranteed failure. */}
          {!isLoading && !tierPackageAvailable && (
            <Text style={styles.unavailableNote}>
              {tierLabel} isn’t available for purchase on your device yet — it’s still being set up in the App Store.
            </Text>
          )}

          <TouchableOpacity
            style={[
              styles.upgradeBtn,
              { backgroundColor: tierColor },
              !isLoading && !tierPackageAvailable && { opacity: 0.5 },
            ]}
            onPress={handleUpgrade}
            disabled={isPurchasing || (!isLoading && !tierPackageAvailable)}
            activeOpacity={0.85}
            testID="paywall-upgrade-btn"
          >
            {isPurchasing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MageAIMark size={18} color="#fff" />
                <Text style={styles.upgradeBtnText}>
                  {!isLoading && !tierPackageAvailable ? `${tierLabel} unavailable` : `Upgrade to ${tierLabel}`}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={handleDismiss} style={styles.notNowBtn} testID="paywall-not-now">
            <Text style={styles.notNowText}>Not now</Text>
          </TouchableOpacity>

          <View style={styles.trustRow}>
            <Shield size={13} color={themeColors.textSecondary} />
            <Text style={styles.trustText}>
              Secure payment via {Platform.OS === 'ios' ? 'App Store' : Platform.OS === 'android' ? 'Google Play' : 'your platform'}. Cancel anytime.
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: t.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: t.line,
  },
  headerTitle: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.text },
  closeBtn: {
    width: 36, height: 36, borderRadius: Tokens.radius.xl,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, alignItems: 'center' },
  heroIconWrap: {
    width: 76, height: 76, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  featureName: {
    fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text,
    letterSpacing: -0.4, textAlign: 'center', marginBottom: 4,
  },
  requiresLine: { fontSize: Type.subhead.fontSize, color: t.textSecondary, marginBottom: 22 },
  requiresTierEm: { fontWeight: '700' as const },
  benefitsBox: {
    width: '100%',
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: t.line,
    marginBottom: 20,
  },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  benefitText: { flex: 1, fontSize: Type.bodyCompact.fontSize, color: t.text, lineHeight: 20 },
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: t.surfaceAlt,
    padding: 4,
    borderRadius: Tokens.radius.card,
    marginBottom: 14,
    width: '100%',
    gap: 4,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  toggleBtnActive: {
    backgroundColor: t.surface,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  toggleText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  toggleTextActive: { color: t.text },
  saveBadge: {
    backgroundColor: t.success + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Tokens.radius.xs,
  },
  saveBadgeText: { fontSize: 10, fontWeight: '700' as const, color: t.success },
  priceBox: { alignItems: 'center', marginBottom: 20 },
  priceBig: { fontSize: Type.largeTitle.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.8 },
  priceSub: { fontSize: Type.footnote.fontSize, color: t.textSecondary, marginTop: 2 },
  savingsRow: { marginTop: 10, backgroundColor: Colors.successLight, borderRadius: Tokens.radius.sm, paddingHorizontal: 12, paddingVertical: 5 },
  savingsRowText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.success },
  savingsRowAmount: { fontWeight: '800' as const, color: t.success },
  // Upgrade CTA — beefed shadow + bigger height + heavier weight so it
  // feels like THE primary action on the screen. Colored shadow uses the
  // tier color (set inline on the button) tinted to ~30% so the button
  // glows softly without looking like a sticker.
  upgradeBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
    borderRadius: Tokens.radius.lg,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 6,
  },
  upgradeBtnText: { color: '#fff', fontSize: Type.body.fontSize, fontWeight: '800' as const, letterSpacing: 0.2 },
  notNowBtn: { paddingVertical: 12 },
  notNowText: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  unavailableNote: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 18,
    marginBottom: 10,
    paddingHorizontal: 8,
  },
  trustRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
    paddingHorizontal: 16,
  },
  trustText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, textAlign: 'center' },
  webExplain: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center' as const, lineHeight: 20, marginHorizontal: 16, marginBottom: 18 },
});
