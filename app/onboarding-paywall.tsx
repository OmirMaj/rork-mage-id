import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import {
  X,
  HardHat,
  Calculator,
  CalendarDays,
  FileText,
  ClipboardList,
  Mic,
  BookOpen,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useSubscription } from '@/contexts/SubscriptionContext';

/**
 * Onboarding-style paywall — single-screen, trial-narrative, big-CTA
 * pattern popularized by Cal AI / Opal / Oasis / Superhuman. Different
 * audience than `app/paywall.tsx` (the settings upgrade comparison
 * table): this screen is shown immediately after the onboarding carousel
 * for net-new users, and re-shown to free-tier users for their first
 * three days (see the 3-day gate in `app/_layout.tsx`).
 *
 * Why this layout works:
 *   - One tier is featured, not three — removes "which plan?" paralysis.
 *   - Annual is the default selection with a visible savings badge, so
 *     the psychologically cheaper-per-month number lands first.
 *   - Business is still reachable via a secondary tab so power users
 *     aren't pushed into the wrong plan.
 *   - Dismissable. The X sends the user to /home; we never hard-gate
 *     the app behind the paywall post-signup.
 *
 * Pricing is resolved from RevenueCat packages when available, falling
 * back to the canonical strings the user signed off on. Keeping fallbacks
 * means the screen renders correctly even before RC offerings have
 * hydrated (cold boot, offline, or a mis-configured build).
 */

const STORAGE_KEY_FIRST_SEEN = 'buildwise_onboarding_paywall_first_at';
const STORAGE_KEY_LAST_SEEN = 'buildwise_onboarding_paywall_last_at';

// Canonical pricing the user specified. Used as a fallback when RC hasn't
// loaded, and as source-of-truth for copy like "Save 20%" derivation.
const FALLBACK_PRICING = {
  proMonthly: '$29.99',
  proAnnualPerMonth: '$24.16',
  proAnnualTotal: '$289.99',
  businessMonthly: '$79.99',
  businessAnnualPerMonth: '$64.16',
  businessAnnualTotal: '$769.99',
} as const;

type Plan = 'pro' | 'business';
type Period = 'monthly' | 'annual';

interface Feature {
  title: string;
  description: string;
  Icon: typeof HardHat;
}

const FEATURES: Feature[] = [
  {
    title: 'AI Cost Estimator',
    description: 'Turn a scope description into a line-item estimate in seconds.',
    Icon: Calculator,
  },
  {
    title: 'Schedule Maker',
    description: 'Generate critical-path Gantt schedules with crew and phase logic.',
    Icon: CalendarDays,
  },
  {
    title: 'PDF Export & Sharing',
    description: 'Export estimates, invoices, and reports as branded PDFs.',
    Icon: FileText,
  },
  {
    title: 'Daily Field Reports',
    description: 'Log work completed, issues, and weather from the field.',
    Icon: ClipboardList,
  },
  {
    title: 'Voice-to-Report',
    description: 'Dictate updates and let MAGE build the report for you.',
    Icon: Mic,
  },
  {
    title: 'Construction AI',
    description: 'Look up building codes, permits, and inspection requirements.',
    Icon: BookOpen,
  },
];

export default function OnboardingPaywallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    purchasePro,
    purchaseBusiness,
    restorePurchases,
    proPackage,
    proAnnualPackage,
    businessPackage,
    businessAnnualPackage,
    isPurchasing,
    isLoading,
  } = useSubscription();

  const [selectedPlan, setSelectedPlan] = useState<Plan>('pro');
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('annual');

  // Stamp first-seen on mount so the 3-day gate has an anchor. `setItem`
  // is a no-op if the key already exists (via getItem check) — we never
  // want to reset the 3-day countdown just because the user re-opens.
  useEffect(() => {
    (async () => {
      try {
        const existing = await AsyncStorage.getItem(STORAGE_KEY_FIRST_SEEN);
        if (!existing) {
          await AsyncStorage.setItem(
            STORAGE_KEY_FIRST_SEEN,
            new Date().toISOString(),
          );
        }
        await AsyncStorage.setItem(
          STORAGE_KEY_LAST_SEEN,
          new Date().toISOString(),
        );
      } catch (err) {
        console.log('[OnboardingPaywall] storage stamp failed', err);
      }
    })();
  }, []);

  // Pull prices from RC when available, otherwise fall back to canonical
  // strings. We don't derive the annual "per month" price from RC's
  // totalled annual figure because intro-pricing and locale formatting
  // can make the math off by a cent — the hand-authored per-month copy
  // is what the user expects to see.
  const pricing = useMemo(() => {
    return {
      proMonthly: proPackage?.product?.priceString ?? FALLBACK_PRICING.proMonthly,
      proAnnualPerMonth: FALLBACK_PRICING.proAnnualPerMonth,
      proAnnualTotal:
        proAnnualPackage?.product?.priceString ?? FALLBACK_PRICING.proAnnualTotal,
      businessMonthly:
        businessPackage?.product?.priceString ?? FALLBACK_PRICING.businessMonthly,
      businessAnnualPerMonth: FALLBACK_PRICING.businessAnnualPerMonth,
      businessAnnualTotal:
        businessAnnualPackage?.product?.priceString ??
        FALLBACK_PRICING.businessAnnualTotal,
    };
  }, [proPackage, proAnnualPackage, businessPackage, businessAnnualPackage]);

  const handleClose = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    // Stamp last-seen so today's gate doesn't immediately re-show on next boot.
    void AsyncStorage.setItem(STORAGE_KEY_LAST_SEEN, new Date().toISOString());
    router.replace('/(tabs)/summary' as any);
  }, [router]);

  const handlePurchase = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (selectedPlan === 'pro') {
        await purchasePro(selectedPeriod);
      } else {
        await purchaseBusiness(selectedPeriod);
      }
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert(
        'Welcome to MAGE ID ' + (selectedPlan === 'pro' ? 'Pro' : 'Business') + '!',
        'Your subscription is active.',
      );
      router.replace('/(tabs)/summary' as any);
    } catch (err: unknown) {
      const cancelled =
        err &&
        typeof err === 'object' &&
        'userCancelled' in err &&
        (err as { userCancelled: boolean }).userCancelled;
      if (cancelled) return;
      console.log('[OnboardingPaywall] purchase failed', err);
      Alert.alert(
        'Purchase Failed',
        'Something went wrong. Please try again, or tap Restore if you already purchased.',
      );
    }
  }, [selectedPlan, selectedPeriod, purchasePro, purchaseBusiness, router]);

  const handleRestore = useCallback(async () => {
    try {
      await restorePurchases();
      Alert.alert('Restored', 'Your purchases have been restored.');
      router.replace('/(tabs)/summary' as any);
    } catch (err) {
      console.log('[OnboardingPaywall] restore failed', err);
      Alert.alert('Nothing to Restore', 'We couldn\'t find an active subscription.');
    }
  }, [restorePurchases, router]);

  const openLegal = useCallback((kind: 'privacy' | 'terms') => {
    const url =
      kind === 'privacy'
        ? 'https://mageid.com/privacy'
        : 'https://mageid.com/terms';
    void Linking.openURL(url);
  }, []);

  // CTA copy shifts with the selection so the button reads like the
  // specific action the user is about to take.
  const ctaLabel = useMemo(() => {
    if (isPurchasing) return 'Processing…';
    const planLabel = selectedPlan === 'pro' ? 'Pro' : 'Business';
    return `Start MAGE ID ${planLabel}`;
  }, [selectedPlan, isPurchasing]);

  const priceFootnote = useMemo(() => {
    if (selectedPlan === 'pro') {
      return selectedPeriod === 'annual'
        ? `${pricing.proAnnualPerMonth}/mo · billed annually (${pricing.proAnnualTotal}/yr)`
        : `${pricing.proMonthly}/mo · billed monthly`;
    }
    return selectedPeriod === 'annual'
      ? `${pricing.businessAnnualPerMonth}/mo · billed annually (${pricing.businessAnnualTotal}/yr)`
      : `${pricing.businessMonthly}/mo · billed monthly`;
  }, [selectedPlan, selectedPeriod, pricing]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header: brand lockup + close */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandBadge}>
            <HardHat size={14} color={Colors.primary} strokeWidth={2.4} />
          </View>
          <Text style={styles.brandName}>MAGE ID</Text>
        </View>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={handleClose}
          testID="onboarding-paywall-close"
        >
          <X size={20} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.hero}>Unlock every tool on the jobsite</Text>

        {/* Feature list with vertical gradient rail */}
        <View style={styles.featureBlock}>
          <View style={styles.railWrap} pointerEvents="none">
            <LinearGradient
              colors={[Colors.primary, Colors.primary + '55']}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.rail}
            />
          </View>
          {FEATURES.map((f, i) => {
            const Icon = f.Icon;
            return (
              <View key={f.title} style={styles.featureRow}>
                <View style={styles.railIconWrap}>
                  <View
                    style={[
                      styles.railIcon,
                      {
                        // Alternate between solid and tinted so the rail
                        // reads as a gradient with "stops" rather than a
                        // flat color block.
                        backgroundColor:
                          i % 2 === 0 ? Colors.primary : Colors.primary + 'DD',
                      },
                    ]}
                  >
                    <Icon size={16} color={Colors.textOnPrimary} strokeWidth={2.2} />
                  </View>
                </View>
                <View style={styles.featureCopy}>
                  <Text style={styles.featureTitle}>{f.title}</Text>
                  <Text style={styles.featureDesc}>{f.description}</Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* Period toggle */}
        <View style={styles.periodToggle}>
          <TouchableOpacity
            style={[
              styles.periodOption,
              selectedPeriod === 'annual' && styles.periodOptionActive,
            ]}
            onPress={() => {
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
              setSelectedPeriod('annual');
            }}
            testID="period-annual"
          >
            <Text
              style={[
                styles.periodLabel,
                selectedPeriod === 'annual' && styles.periodLabelActive,
              ]}
            >
              Annual
            </Text>
            <View style={styles.saveBadge}>
              <Text style={styles.saveBadgeText}>SAVE 20%</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.periodOption,
              selectedPeriod === 'monthly' && styles.periodOptionActive,
            ]}
            onPress={() => {
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
              setSelectedPeriod('monthly');
            }}
            testID="period-monthly"
          >
            <Text
              style={[
                styles.periodLabel,
                selectedPeriod === 'monthly' && styles.periodLabelActive,
              ]}
            >
              Monthly
            </Text>
          </TouchableOpacity>
        </View>

        {/* Plan cards */}
        <View style={styles.planRow}>
          <PlanCard
            label="Pro"
            tagline="For active GCs"
            priceTop={
              selectedPeriod === 'annual' ? pricing.proAnnualPerMonth : pricing.proMonthly
            }
            priceBottom={
              selectedPeriod === 'annual'
                ? `${pricing.proAnnualTotal}/yr`
                : 'billed monthly'
            }
            active={selectedPlan === 'pro'}
            onPress={() => {
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
              setSelectedPlan('pro');
            }}
            testID="plan-pro"
            featured
          />
          <PlanCard
            label="Business"
            tagline="Teams & unlimited"
            priceTop={
              selectedPeriod === 'annual'
                ? pricing.businessAnnualPerMonth
                : pricing.businessMonthly
            }
            priceBottom={
              selectedPeriod === 'annual'
                ? `${pricing.businessAnnualTotal}/yr`
                : 'billed monthly'
            }
            active={selectedPlan === 'business'}
            onPress={() => {
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
              setSelectedPlan('business');
            }}
            testID="plan-business"
          />
        </View>

        <Text style={styles.priceFootnote}>{priceFootnote}</Text>

        <TouchableOpacity
          style={[styles.cta, isPurchasing && styles.ctaDisabled]}
          onPress={handlePurchase}
          disabled={isPurchasing || isLoading}
          activeOpacity={0.88}
          testID="onboarding-paywall-cta"
        >
          {isPurchasing ? (
            <ActivityIndicator color={Colors.textOnPrimary} size="small" />
          ) : (
            <Text style={styles.ctaLabel}>{ctaLabel}</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.reassurance}>
          Cancel anytime in Settings. No hidden fees.
        </Text>

        <View style={styles.legalRow}>
          <TouchableOpacity onPress={() => openLegal('privacy')}>
            <Text style={styles.legalLink}>Privacy</Text>
          </TouchableOpacity>
          <Text style={styles.legalDot}>·</Text>
          <TouchableOpacity onPress={handleRestore}>
            <Text style={styles.legalLink}>Restore</Text>
          </TouchableOpacity>
          <Text style={styles.legalDot}>·</Text>
          <TouchableOpacity onPress={() => openLegal('terms')}>
            <Text style={styles.legalLink}>Terms</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

interface PlanCardProps {
  label: string;
  tagline: string;
  priceTop: string;
  priceBottom: string;
  active: boolean;
  featured?: boolean;
  onPress: () => void;
  testID?: string;
}

function PlanCard({
  label,
  tagline,
  priceTop,
  priceBottom,
  active,
  featured,
  onPress,
  testID,
}: PlanCardProps) {
  return (
    <TouchableOpacity
      style={[styles.planCard, active && styles.planCardActive]}
      onPress={onPress}
      activeOpacity={0.85}
      testID={testID}
    >
      {featured && (
        <View style={styles.popularBadge}>
          <Text style={styles.popularBadgeText}>POPULAR</Text>
        </View>
      )}
      <Text style={[styles.planLabel, active && styles.planLabelActive]}>{label}</Text>
      <Text style={styles.planTagline}>{tagline}</Text>
      <View style={styles.planPriceBlock}>
        <Text style={[styles.planPriceTop, active && styles.planPriceTopActive]}>
          {priceTop}
        </Text>
        <Text style={styles.planPriceUnit}>/mo</Text>
      </View>
      <Text style={styles.planPriceBottom}>{priceBottom}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandBadge: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: Colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: 0.2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  hero: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.8,
    marginBottom: 28,
  },
  featureBlock: {
    position: 'relative',
    marginBottom: 24,
  },
  railWrap: {
    position: 'absolute',
    left: 16,
    top: 8,
    bottom: 8,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rail: {
    width: 36,
    height: '100%',
    borderRadius: 18,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 18,
    minHeight: 52,
  },
  railIconWrap: {
    width: 68,
    alignItems: 'center',
    paddingTop: 2,
  },
  railIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureCopy: {
    flex: 1,
    paddingTop: 2,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 3,
    letterSpacing: -0.2,
  },
  featureDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  periodToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
  },
  periodOption: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    flexDirection: 'row',
    gap: 6,
  },
  periodOptionActive: {
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  periodLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  periodLabelActive: {
    color: Colors.text,
  },
  saveBadge: {
    backgroundColor: Colors.success + '25',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  saveBadgeText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: Colors.success,
    letterSpacing: 0.4,
  },
  planRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  planCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: 14,
    position: 'relative',
    minHeight: 140,
  },
  planCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08',
  },
  popularBadge: {
    position: 'absolute',
    top: -9,
    right: 10,
    backgroundColor: Colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },
  popularBadgeText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: Colors.textOnPrimary,
    letterSpacing: 0.6,
  },
  planLabel: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  planLabelActive: {
    color: Colors.primary,
  },
  planTagline: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
    marginBottom: 14,
  },
  planPriceBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  planPriceTop: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.6,
  },
  planPriceTopActive: {
    color: Colors.primary,
  },
  planPriceUnit: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
  },
  planPriceBottom: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  priceFootnote: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 14,
  },
  cta: {
    height: 54,
    borderRadius: 14,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: {
    opacity: 0.6,
  },
  ctaLabel: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  reassurance: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 16,
  },
  legalLink: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  legalDot: {
    fontSize: 12,
    color: Colors.textMuted,
  },
});
