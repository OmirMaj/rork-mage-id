import React, { useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  CheckCircle, XCircle, Crown, Zap, Building2, X, Shield,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useSubscription } from '@/contexts/SubscriptionContext';

interface FeatureRow {
  label: string;
  free: boolean;
  pro: boolean;
  business: boolean;
}

const FEATURES: FeatureRow[] = [
  { label: 'Active Projects', free: true, pro: true, business: true },
  { label: 'AI Cost Estimator', free: true, pro: true, business: true },
  { label: 'PDF Export & Sharing', free: false, pro: true, business: true },
  { label: 'Schedule Maker (Gantt)', free: false, pro: true, business: true },
  { label: 'Change Orders & Invoicing', free: false, pro: true, business: true },
  { label: 'Daily Field Reports', free: false, pro: true, business: true },
  { label: 'Voice-to-Report', free: false, pro: true, business: true },
  { label: 'Photo Documentation', free: false, pro: true, business: true },
  { label: 'Price Alerts', free: false, pro: true, business: true },
  { label: 'Equipment Tracking', free: false, pro: true, business: true },
  { label: 'Budget Health (EVM)', free: false, pro: true, business: true },
  { label: 'Subcontractor Management', free: false, pro: false, business: true },
  { label: 'Punch List & Closeout', free: false, pro: false, business: true },
  { label: 'RFIs & Submittals', free: false, pro: false, business: true },
  { label: 'Full Budget Dashboard', free: false, pro: false, business: true },
  { label: 'Client Portal', free: false, pro: false, business: true },
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
    tier, purchasePro, purchaseBusiness, restorePurchases,
    isLoading, isPurchasing, proPackage, businessPackage,
  } = useSubscription();

  const packagesLoaded = !!proPackage || !!businessPackage;
  const packagesStillLoading = isLoading && !packagesLoaded;

  const proPrice = proPackage?.product?.priceString ?? (packagesStillLoading ? null : '$24.16/mo');
  const businessPrice = businessPackage?.product?.priceString ?? (packagesStillLoading ? null : '$63.99/mo');
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

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} testID="paywall-close">
          <X size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Choose Your Plan</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.plansRow}>
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

        <TouchableOpacity onPress={handleRestore} style={styles.restoreBtn} disabled={isFallbackPricing} testID="restore-purchases">
          <Text style={[styles.restoreText, isFallbackPricing && { color: Colors.textMuted }]}>Restore Purchases</Text>
        </TouchableOpacity>

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
    borderRadius: 18,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  plansRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 28,
  },
  planCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 16,
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
    borderRadius: 6,
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
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    marginTop: 4,
  },
  planName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  planPrice: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  planPeriod: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  currentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  currentBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  ctaBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    width: '100%' as const,
    alignItems: 'center',
  },
  ctaBtnText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#fff',
  },
  compareTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  compareTable: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
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
    fontSize: 13,
    color: Colors.text,
    fontWeight: '400' as const,
  },
  compareHeaderCell: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  compareCenterCell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
  },
  trustText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  restoreBtn: {
    alignSelf: 'center',
    paddingVertical: 12,
  },
  restoreText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  loadingOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  loadingText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  fallbackNotice: {
    backgroundColor: Colors.fillSecondary,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  fallbackNoticeText: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 18,
  },
  ctaBtnDisabled: {
    opacity: 0.45,
  },
});
