import React, { useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform,
  ActivityIndicator, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  CheckCircle, XCircle, Crown, Zap, Building2, Rocket, X, Shield,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface FeatureRow {
  label: string;
  free: boolean;
  pro: boolean;
  business: boolean;
}

// Enterprise has the same FEATURE access as Business — its differentiator
// is higher AI usage caps, surfaced in AI_LIMITS below. Keeping the feature
// table at three columns avoids 5-column squeeze on phones and (more
// importantly) avoids the visual lie of a column with identical checkmarks
// to the one next to it.
//
// Audit cleanup (May 2026): rows below ONLY appear if there is a real,
// enforced gate in the codebase. Rows that previously claimed Pro-only
// access for features that worked on Free (Daily Field Reports manual
// version, Photo Documentation, Price Alerts) were either dropped or
// re-classified to match reality. SSO/SAML, Multi-tenant, Time tracking,
// and QuickBooks sync rows were removed entirely — those features aren't
// built. See utils/owner.ts comment for the gating rules.
const FEATURES: FeatureRow[] = [
  { label: 'Unlimited Projects', free: true, pro: true, business: true },
  { label: 'Manual Estimates', free: true, pro: true, business: true },
  { label: 'Manual Daily Reports', free: true, pro: true, business: true },
  { label: 'AI Cost Estimator', free: false, pro: true, business: true },
  { label: 'AI Takeoff (PDF → LF/SF)', free: false, pro: true, business: true },
  { label: 'AI Schedule Builder (Gantt)', free: false, pro: true, business: true },
  { label: 'Voice-to-Report (Android: beta)', free: false, pro: true, business: true },
  { label: 'AI Photo Triage / Punch', free: false, pro: true, business: true },
  { label: 'Cash Flow + EVM (CPI/SPI)', free: false, pro: true, business: true },
  { label: 'AIA G702/G703 Pay Apps', free: false, pro: true, business: true },
  { label: 'Change Orders + Invoicing', free: false, pro: true, business: true },
  { label: 'Equipment Tracking', free: false, pro: true, business: true },
  { label: 'Client Portal (custom branded)', free: false, pro: true, business: true },
  { label: 'Subcontractor Management', free: false, pro: false, business: true },
  { label: 'Punch List & Closeout', free: false, pro: false, business: true },
  { label: 'RFIs & Submittals', free: false, pro: false, business: true },
  { label: 'Full Budget Dashboard', free: false, pro: false, business: true },
  { label: 'Plan Viewer · Sheet Pinning (Android: beta)', free: false, pro: false, business: true },
];

// AI quota table — Enterprise's actual value prop. Numbers must stay in
// sync with utils/aiRateLimiter.ts (LIMITS) and supabase/functions/_shared/
// auth.ts (MONTHLY_CAPS). Strings, not numbers, so we can show "Unlimited"
// or "—" cleanly.
interface AILimitRow { label: string; free: string; pro: string; business: string; enterprise: string }
const AI_LIMITS: AILimitRow[] = [
  { label: 'Daily AI requests',    free: '5',   pro: '30',  business: '80',  enterprise: '150' },
  { label: 'Advanced AI / day',    free: '—',   pro: '6',   business: '18',  enterprise: '40'  },
  { label: 'Drawing analyses /mo', free: '—',   pro: '15',  business: '50',  enterprise: '100' },
  { label: 'Photo analyses /mo',   free: '—',   pro: '50',  business: '150', enterprise: '200' },
];

function FeatureCheck({ available }: { available: boolean }) {
  return available
    ? <CheckCircle size={16} color={Colors.success} />
    : <XCircle size={16} color={Colors.textMuted} />;
}

export default function PaywallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    tier, purchasePro, purchaseBusiness, purchaseEnterprise, restorePurchases,
    isLoading, isPurchasing, proPackage, businessPackage, enterprisePackage,
  } = useSubscription();

  const packagesLoaded = !!proPackage || !!businessPackage || !!enterprisePackage;
  const packagesStillLoading = isLoading && !packagesLoaded;

  // Fallback prices match the published list rate. RC's `priceString` wins
  // when offerings are loaded — this is just for the offline / pre-load /
  // unconfigured-RC case so the screen still renders the published price.
  const proPrice = proPackage?.product?.priceString ?? (packagesStillLoading ? null : '$29/mo');
  const businessPrice = businessPackage?.product?.priceString ?? (packagesStillLoading ? null : '$79/mo');
  const enterprisePrice = enterprisePackage?.product?.priceString ?? (packagesStillLoading ? null : '$150/mo');
  const isFallbackPricing = !packagesLoaded && !packagesStillLoading;

  const handlePurchasePro = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await purchasePro();
      Alert.alert('Welcome to Pro!', 'You now have access to all Pro features.');
      router.back();
    } catch (err: unknown) {
      const isCancelled = err && typeof err === 'object' && 'userCancelled' in err && (err as { userCancelled: boolean }).userCancelled;
      if (isCancelled) {
        console.log('[Paywall] User cancelled Pro purchase');
        return;
      }
      console.log('[Paywall] Purchase Pro failed:', err);
      Alert.alert('Purchase Failed', 'Could not complete the purchase. Please try again.');
    }
  }, [purchasePro, router]);

  const handlePurchaseBusiness = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await purchaseBusiness();
      Alert.alert('Welcome to Business!', 'You now have access to all features.');
      router.back();
    } catch (err: unknown) {
      const isCancelled = err && typeof err === 'object' && 'userCancelled' in err && (err as { userCancelled: boolean }).userCancelled;
      if (isCancelled) {
        console.log('[Paywall] User cancelled Business purchase');
        return;
      }
      console.log('[Paywall] Purchase Business failed:', err);
      Alert.alert('Purchase Failed', 'Could not complete the purchase. Please try again.');
    }
  }, [purchaseBusiness, router]);

  const handlePurchaseEnterprise = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await purchaseEnterprise();
      Alert.alert('Welcome to Enterprise!', "You're on the highest plan with the highest AI usage caps.");
      router.back();
    } catch (err: unknown) {
      const isCancelled = err && typeof err === 'object' && 'userCancelled' in err && (err as { userCancelled: boolean }).userCancelled;
      if (isCancelled) {
        console.log('[Paywall] User cancelled Enterprise purchase');
        return;
      }
      // Most likely cause: the RC product hasn't been configured yet. Surface
      // a help-friendly message rather than the generic "purchase failed."
      const msg = err instanceof Error ? err.message : 'Could not complete the purchase. Please try again.';
      console.log('[Paywall] Purchase Enterprise failed:', err);
      Alert.alert('Enterprise unavailable', msg);
    }
  }, [purchaseEnterprise, router]);

  const handleRestore = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await restorePurchases();
      Alert.alert('Restored', 'Your purchases have been restored.');
    } catch (err) {
      console.log('[Paywall] Restore failed:', err);
      Alert.alert('Restore Failed', 'Could not restore purchases. Please try again.');
    }
  }, [restorePurchases]);

  const openLegal = useCallback((kind: 'privacy' | 'terms') => {
    const url = kind === 'privacy'
      ? 'https://mageid.com/privacy'
      : 'https://mageid.com/terms';
    void Linking.openURL(url);
  }, []);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} testID="paywall-close" accessibilityRole="button" accessibilityLabel="Close">
          <X size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Choose Your Plan</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* 4-tier grid. Phone width forces 2x2 (each card ~48% wide); a
            wider screen pulls all four onto one row via flexWrap. Earlier
            iterations used a horizontal flex:1 row of 3 cards which would
            squeeze each card to ~78px when a 4th joined. */}
        <View style={styles.plansGrid}>
          <View style={[styles.planCard, tier === 'free' && styles.planCardActive]}>
            <View style={[styles.planIconWrap, { backgroundColor: Colors.fillTertiary }]}>
              <Zap size={20} color={Colors.textSecondary} />
            </View>
            <Text style={styles.planName}>Free</Text>
            <Text style={styles.planPrice}>$0</Text>
            <Text style={styles.planPeriod}>forever</Text>
            {tier === 'free' && (
              <View style={[styles.currentBadge, { backgroundColor: Colors.fillTertiary }]}>
                <Text style={[styles.currentBadgeText, { color: Colors.textSecondary }]}>Current</Text>
              </View>
            )}
          </View>

          <View style={[styles.planCard, styles.planCardHighlight, tier === 'pro' && styles.planCardActive]}>
            <View style={styles.popularTag}>
              <Text style={styles.popularTagText}>POPULAR</Text>
            </View>
            <View style={[styles.planIconWrap, { backgroundColor: Colors.primary + '20' }]}>
              <Crown size={20} color={Colors.primary} />
            </View>
            <Text style={styles.planName}>Pro</Text>
            {proPrice ? (
              <Text style={styles.planPrice}>{proPrice}</Text>
            ) : (
              <ActivityIndicator size="small" color={Colors.primary} style={{ height: 22 }} />
            )}
            <Text style={styles.planPeriod}>per month</Text>
            {tier === 'pro' ? (
              <View style={[styles.currentBadge, { backgroundColor: Colors.success + '20' }]}>
                <Text style={[styles.currentBadgeText, { color: Colors.success }]}>Current</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.ctaBtn, isFallbackPricing && styles.ctaBtnDisabled]}
                onPress={handlePurchasePro}
                activeOpacity={0.85}
                disabled={isPurchasing || isFallbackPricing}
                testID="buy-pro"
              >
                {isPurchasing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.ctaBtnText}>Subscribe</Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          <View style={[styles.planCard, tier === 'business' && styles.planCardActive]}>
            <View style={[styles.planIconWrap, { backgroundColor: Colors.accent + '20' }]}>
              <Building2 size={20} color={Colors.accent} />
            </View>
            <Text style={styles.planName}>Business</Text>
            {businessPrice ? (
              <Text style={styles.planPrice}>{businessPrice}</Text>
            ) : (
              <ActivityIndicator size="small" color={Colors.accent} style={{ height: 22 }} />
            )}
            <Text style={styles.planPeriod}>per month</Text>
            {tier === 'business' ? (
              <View style={[styles.currentBadge, { backgroundColor: Colors.success + '20' }]}>
                <Text style={[styles.currentBadgeText, { color: Colors.success }]}>Current</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.ctaBtn, { backgroundColor: Colors.accent }, isFallbackPricing && styles.ctaBtnDisabled]}
                onPress={handlePurchaseBusiness}
                activeOpacity={0.85}
                disabled={isPurchasing || isFallbackPricing}
                testID="buy-business"
              >
                {isPurchasing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.ctaBtnText}>Subscribe</Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          <View style={[styles.planCard, tier === 'enterprise' && styles.planCardActive]}>
            <View style={[styles.planIconWrap, { backgroundColor: Colors.warning + '20' }]}>
              <Rocket size={20} color={Colors.warning} />
            </View>
            <Text style={styles.planName}>Enterprise</Text>
            {enterprisePrice ? (
              <Text style={styles.planPrice}>{enterprisePrice}</Text>
            ) : (
              <ActivityIndicator size="small" color={Colors.warning} style={{ height: 22 }} />
            )}
            <Text style={styles.planPeriod}>per month</Text>
            {tier === 'enterprise' ? (
              <View style={[styles.currentBadge, { backgroundColor: Colors.success + '20' }]}>
                <Text style={[styles.currentBadgeText, { color: Colors.success }]}>Current</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.ctaBtn, { backgroundColor: Colors.warning }, isFallbackPricing && styles.ctaBtnDisabled]}
                onPress={handlePurchaseEnterprise}
                activeOpacity={0.85}
                disabled={isPurchasing || isFallbackPricing}
                testID="buy-enterprise"
              >
                {isPurchasing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.ctaBtnText}>Subscribe</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Text style={styles.compareTitle}>Feature Comparison</Text>
        <View style={styles.compareTable}>
          <View style={styles.compareHeaderRow}>
            <Text style={[styles.compareCell, styles.compareLabelCell]}>Feature</Text>
            <Text style={[styles.compareCell, styles.compareHeaderCell]}>Free</Text>
            <Text style={[styles.compareCell, styles.compareHeaderCell]}>Pro</Text>
            <Text style={[styles.compareCell, styles.compareHeaderCell]}>Biz</Text>
          </View>
          {FEATURES.map((f) => (
            <View key={f.label} style={styles.compareRow}>
              <Text style={[styles.compareCell, styles.compareLabelCell]} numberOfLines={2}>{f.label}</Text>
              <View style={[styles.compareCell, styles.compareCenterCell]}>
                <FeatureCheck available={f.free} />
              </View>
              <View style={[styles.compareCell, styles.compareCenterCell]}>
                <FeatureCheck available={f.pro} />
              </View>
              <View style={[styles.compareCell, styles.compareCenterCell]}>
                <FeatureCheck available={f.business} />
              </View>
            </View>
          ))}
        </View>

        {/* AI Usage Limits — Enterprise's actual differentiator. Same
            features as Business, but more headroom for heavy AI users. */}
        <Text style={styles.compareTitle}>AI Usage Limits</Text>
        <View style={styles.compareTable}>
          <View style={styles.compareHeaderRow}>
            <Text style={[styles.compareCell, styles.compareLabelCell]}>Quota</Text>
            <Text style={[styles.aiCell, styles.compareHeaderCell]}>Free</Text>
            <Text style={[styles.aiCell, styles.compareHeaderCell]}>Pro</Text>
            <Text style={[styles.aiCell, styles.compareHeaderCell]}>Biz</Text>
            <Text style={[styles.aiCell, styles.compareHeaderCell]}>Ent</Text>
          </View>
          {AI_LIMITS.map((row) => (
            <View key={row.label} style={styles.compareRow}>
              <Text style={[styles.compareCell, styles.compareLabelCell]} numberOfLines={2}>{row.label}</Text>
              <Text style={[styles.aiCell, styles.aiValueText]}>{row.free}</Text>
              <Text style={[styles.aiCell, styles.aiValueText]}>{row.pro}</Text>
              <Text style={[styles.aiCell, styles.aiValueText]}>{row.business}</Text>
              <Text style={[styles.aiCell, styles.aiValueText, styles.aiValueTextEnt]}>{row.enterprise}</Text>
            </View>
          ))}
        </View>

        <View style={styles.trustRow}>
          <Shield size={14} color={Colors.textSecondary} />
          <Text style={styles.trustText}>
            Secure payment via {Platform.OS === 'ios' ? 'App Store' : Platform.OS === 'android' ? 'Google Play' : 'your platform'}. Cancel anytime.
          </Text>
        </View>

        {isFallbackPricing && (
          <View style={styles.fallbackNotice}>
            <Text style={styles.fallbackNoticeText}>
              Prices shown are estimates. In-app purchasing is currently unavailable.
            </Text>
          </View>
        )}

        <View style={styles.legalRow}>
          <TouchableOpacity onPress={() => openLegal('privacy')}>
            <Text style={styles.legalLink}>Privacy</Text>
          </TouchableOpacity>
          <Text style={styles.legalDot}>·</Text>
          <TouchableOpacity onPress={handleRestore} disabled={isFallbackPricing} testID="restore-purchases">
            <Text style={[styles.legalLink, isFallbackPricing && { color: Colors.textMuted }]}>Restore</Text>
          </TouchableOpacity>
          <Text style={styles.legalDot}>·</Text>
          <TouchableOpacity onPress={() => openLegal('terms')}>
            <Text style={styles.legalLink}>Terms</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.legalFinePrint}>
          Subscriptions auto-renew until canceled. Manage or cancel in your {Platform.OS === 'ios' ? 'App Store account' : Platform.OS === 'android' ? 'Google Play account' : 'platform account'} settings at least 24 hours before the renewal date. Payment is charged to your {Platform.OS === 'ios' ? 'Apple ID' : Platform.OS === 'android' ? 'Google account' : 'platform account'} on confirmation of purchase.
        </Text>

        {packagesStillLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={Colors.primary} size="small" />
            <Text style={styles.loadingText}>Loading plans...</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.xl,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  // 2x2 grid via flexWrap. Each card claims ~48% so two fit per row with
  // an 8px gap between. On a wide web layout the row gap stays the same;
  // we deliberately don't go to a 1x4 row because each card would shrink
  // below the readable threshold for the price+CTA.
  plansGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 28,
  },
  planCard: {
    width: '48%' as const,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.panel,
    padding: 14,
    alignItems: 'center',
    gap: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative' as const,
    overflow: 'visible' as const,
  },
  planCardHighlight: {
    borderColor: Colors.primary + '30',
  },
  planCardActive: {
    borderColor: Colors.success,
  },
  popularTag: {
    position: 'absolute' as const,
    top: -10,
    backgroundColor: Colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Tokens.radius.xs,
    zIndex: 1,
  },
  popularTagText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: '#fff',
    letterSpacing: 0.5,
  },
  planIconWrap: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    marginTop: 4,
  },
  planName: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  planPrice: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  planPeriod: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  currentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Tokens.radius.sm,
  },
  currentBadgeText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
  },
  ctaBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    width: '100%' as const,
    alignItems: 'center',
  },
  ctaBtnText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: '#fff',
  },
  compareTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  compareTable: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.panel,
    overflow: 'hidden',
    marginBottom: 20,
  },
  compareHeaderRow: {
    flexDirection: 'row',
    backgroundColor: Colors.fillSecondary,
    paddingVertical: 10,
  },
  compareRow: {
    flexDirection: 'row',
    borderTopWidth: 0.5,
    borderTopColor: Colors.borderLight,
    paddingVertical: 10,
  },
  compareCell: {
    width: 50,
    paddingHorizontal: 4,
  },
  compareLabelCell: {
    flex: 1,
    paddingLeft: 14,
    fontSize: Type.footnote.fontSize,
    color: Colors.text,
    fontWeight: '400' as const,
  },
  compareHeaderCell: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  compareCenterCell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // AI quotas table — narrower cells than feature compare so all 4 tier
  // columns fit on a phone next to the label column.
  aiCell: {
    width: 42,
    paddingHorizontal: 2,
    textAlign: 'center' as const,
  },
  aiValueText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  aiValueTextEnt: {
    color: Colors.warning,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
  },
  trustText: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
  },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  legalLink: {
    fontSize: Type.footnote.fontSize,
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  legalDot: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textMuted,
  },
  legalFinePrint: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    textAlign: 'center' as const,
    lineHeight: 16,
    paddingHorizontal: 24,
    marginTop: 4,
  },
  loadingOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  loadingText: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
  },
  fallbackNotice: {
    backgroundColor: Colors.fillSecondary,
    borderRadius: Tokens.radius.md,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  fallbackNoticeText: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 18,
  },
  ctaBtnDisabled: {
    opacity: 0.45,
  },
});
