import React, { useCallback, useMemo, useState } from 'react';
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
import { Crown, Building2, CheckCircle2, X, Sparkles, Shield } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useSubscription } from '@/contexts/SubscriptionContext';

type RequiredTier = 'pro' | 'business';
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
const FALLBACK_PRICES = {
  pro: { monthly: '$29.99', annual: '$289.99', annualMonthlyEquivalent: '$24.16' },
  business: { monthly: '$79.99', annual: '$769.99', annualMonthlyEquivalent: '$64.16' },
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
  'QuickBooks sync',
  'Plan Viewer & markup tools',
  'Subcontractor management',
  'Punch List & Closeout packets',
  'RFIs, Submittals, and full Budget Dashboard',
];

export default function Paywall({ visible, onClose, feature, requiredTier }: PaywallProps) {
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<BillingPeriod>('annual');
  const {
    purchasePro,
    purchaseBusiness,
    proPackage,
    proAnnualPackage,
    businessPackage,
    businessAnnualPackage,
    isPurchasing,
  } = useSubscription();

  const tierLabel = requiredTier === 'business' ? 'Business' : 'Pro';
  const tierColor = requiredTier === 'business' ? Colors.accent : Colors.primary;
  const TierIcon = requiredTier === 'business' ? Building2 : Crown;
  const benefits = requiredTier === 'business' ? BUSINESS_BENEFITS : PRO_BENEFITS;
  const fallback = FALLBACK_PRICES[requiredTier];

  const pricing = useMemo(() => {
    // Try to use live RevenueCat pricing; fall back to static amounts.
    const monthlyPkg = requiredTier === 'business' ? businessPackage : proPackage;
    const annualPkg = requiredTier === 'business' ? businessAnnualPackage : proAnnualPackage;

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
  }, [requiredTier, proPackage, proAnnualPackage, businessPackage, businessAnnualPackage, fallback]);

  const handleUpgrade = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (requiredTier === 'business') {
        await purchaseBusiness(period);
      } else {
        await purchasePro(period);
      }
      Alert.alert(`Welcome to ${tierLabel}!`, 'Your subscription is now active.');
      onClose();
    } catch (err: unknown) {
      const isCancelled =
        err && typeof err === 'object' && 'userCancelled' in err && (err as { userCancelled: boolean }).userCancelled;
      if (isCancelled) return;
      console.log('[Paywall modal] Purchase failed:', err);
      Alert.alert('Purchase Failed', 'Could not complete the purchase. Please try again.');
    }
  }, [purchasePro, purchaseBusiness, requiredTier, period, tierLabel, onClose]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? 16 : insets.top + 8 }]}>
          <View style={{ width: 36 }} />
          <Text style={styles.headerTitle}>Upgrade Required</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} testID="paywall-modal-close">
            <X size={22} color={Colors.text} />
          </TouchableOpacity>
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
              </>
            )}
          </View>

          <TouchableOpacity
            style={[styles.upgradeBtn, { backgroundColor: tierColor }]}
            onPress={handleUpgrade}
            disabled={isPurchasing}
            activeOpacity={0.85}
            testID="paywall-upgrade-btn"
          >
            {isPurchasing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Sparkles size={18} color="#fff" />
                <Text style={styles.upgradeBtnText}>Upgrade to {tierLabel}</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={styles.notNowBtn} testID="paywall-not-now">
            <Text style={styles.notNowText}>Not now</Text>
          </TouchableOpacity>

          <View style={styles.trustRow}>
            <Shield size={13} color={Colors.textSecondary} />
            <Text style={styles.trustText}>
              Secure payment via {Platform.OS === 'ios' ? 'App Store' : Platform.OS === 'android' ? 'Google Play' : 'your platform'}. Cancel anytime.
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
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
  headerTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, alignItems: 'center' },
  heroIconWrap: {
    width: 76, height: 76, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  featureName: {
    fontSize: 22, fontWeight: '800' as const, color: Colors.text,
    letterSpacing: -0.4, textAlign: 'center', marginBottom: 4,
  },
  requiresLine: { fontSize: 15, color: Colors.textSecondary, marginBottom: 22 },
  requiresTierEm: { fontWeight: '700' as const },
  benefitsBox: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    marginBottom: 20,
  },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  benefitText: { flex: 1, fontSize: 14, color: Colors.text, lineHeight: 20 },
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: Colors.fillTertiary,
    padding: 4,
    borderRadius: 12,
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
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  toggleText: { fontSize: 14, fontWeight: '600' as const, color: Colors.textSecondary },
  toggleTextActive: { color: Colors.text },
  saveBadge: {
    backgroundColor: Colors.success + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  saveBadgeText: { fontSize: 10, fontWeight: '700' as const, color: Colors.success },
  priceBox: { alignItems: 'center', marginBottom: 20 },
  priceBig: { fontSize: 34, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.8 },
  priceSub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  upgradeBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 12,
    marginBottom: 8,
  },
  upgradeBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' as const },
  notNowBtn: { paddingVertical: 12 },
  notNowText: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500' as const },
  trustRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
    paddingHorizontal: 16,
  },
  trustText: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center' },
});
