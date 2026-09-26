import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator, Linking,
  Animated, Easing, type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack, useLocalSearchParams } from 'expo-router';
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
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useSubscription, restoreOutcome } from '@/contexts/SubscriptionContext';
import {
  LIST_PRICE_MONTHLY, PRICE_AT_CHECKOUT, annualPerMonth, annualSavingsPercent,
} from '@/constants/pricing';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { readSignupIntent, clearSignupIntent } from '@/utils/signupIntent';
import { useProjects } from '@/contexts/ProjectContext';
import { INCLUDED_ADMIN_SEATS } from '@/utils/seatModel';
import { nativeDriver, reducedMotion, useSwapFade } from '@/components/ui/motion';
import { planSegmentGlide, type SegRect } from '@/components/ui/SegmentedControl';

// Slick-3: a plan card's accent ring cross-fades over this long.
const RING_MS = 140; // hoist into Motion.duration after round 3

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
 * Pricing is resolved from RevenueCat packages. Before they load (cold
 * boot, offline, a mis-configured build) the monthly card shows the
 * published list rate from constants/pricing.ts, labelled as such, and every
 * ANNUAL figure — per-month equivalent, total, savings badge — says "Price
 * shown at checkout" instead. See the pricing memo below for why (#42).
 */

const STORAGE_KEY_FIRST_SEEN = 'mageid_onboarding_paywall_first_at';
const STORAGE_KEY_LAST_SEEN = 'mageid_onboarding_paywall_last_at';

// (The hand-typed FALLBACK_PRICING table that lived here — $23.20/mo,
// $278.40/yr, "SAVE 20%" — is gone: see the pricing memo in the component.)

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
    title: 'AI Takeoff',
    description: 'Turn a plan PDF into linear- and square-foot quantities.',
    Icon: FileText,
  },
  {
    title: 'AI Photo Triage',
    // #41: punch items are Business (punch_list_closeout); this screen sells
    // Pro first, so it must not promise them.
    description: 'Sort jobsite photos into RFIs, daily-report notes and progress shots.',
    Icon: ClipboardList,
  },
  {
    title: 'Voice-to-Report',
    description: 'Dictate updates and let MAGE build the daily report for you.',
    Icon: Mic,
  },
  {
    title: 'Construction AI',
    description: "Code guidance for your jurisdiction's adopted edition, permit roadmaps and inspection prep.",
    Icon: BookOpen,
  },
];

export default function OnboardingPaywallScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Set by the estimate wizard when the contractor already has a project here.
  // Without it, declining the ask dropped him on Summary, which reads "No
  // projects yet" — the app forgetting the thing he just built, two taps after
  // charging him for it.
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { hasSeenOnboarding, completeOnboarding } = useProjects();
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

  // ── The Annual/Monthly pill glides (the SegmentedControl recipe) ─────────
  // At rest there is none: the selected option paints its own
  // periodOptionActive, exactly as before. On a period change ONE pill mounts
  // at the old option and runs its two edges to the new one on separate
  // springs (edgeSprings via planSegmentGlide), then unmounts in the commit
  // that paints the target's own fill. Reduce Motion: the instant swap.
  const periodRects = useRef<Partial<Record<Period, SegRect>>>({});
  const periodL = useRef(new Animated.Value(0)).current;
  const periodR = useRef(new Animated.Value(0)).current;
  const [periodGlide, setPeriodGlide] = useState<null | { w0: number; to: SegRect }>(null);
  const prevPeriodRef = useRef(selectedPeriod);
  const periodFlightRef = useRef(false);
  useLayoutEffect(() => {
    const prev = prevPeriodRef.current;
    prevPeriodRef.current = selectedPeriod;
    if (prev === selectedPeriod) return;
    const plan = planSegmentGlide(periodRects.current[prev], periodRects.current[selectedPeriod], reducedMotion());
    if (!plan) {
      if (periodFlightRef.current) {
        periodFlightRef.current = false;
        periodL.stopAnimation();
        periodR.stopAnimation();
        setPeriodGlide(null);
      }
      return;
    }
    if (periodFlightRef.current) {
      periodL.stopAnimation();
      periodR.stopAnimation();
    } else {
      periodL.setValue(plan.from.x);
      periodR.setValue(plan.from.x + plan.from.w);
    }
    periodFlightRef.current = true;
    setPeriodGlide({ w0: plan.to.w, to: plan.to });
    Animated.parallel([
      Animated.spring(periodL, { toValue: plan.to.x, ...plan.leftSpring, useNativeDriver: nativeDriver }),
      Animated.spring(periodR, { toValue: plan.to.x + plan.to.w, ...plan.rightSpring, useNativeDriver: nativeDriver }),
    ]).start(({ finished }) => {
      if (!finished) return; // superseded by a newer glide
      periodFlightRef.current = false;
      setPeriodGlide(null);
    });
  }, [selectedPeriod, periodL, periodR]);
  useEffect(() => () => {
    periodL.stopAnimation();
    periodR.stopAnimation();
  }, [periodL, periodR]);
  const measurePeriod = (key: Period) => (e: LayoutChangeEvent) => {
    const { x, y, width, height } = e.nativeEvent.layout;
    periodRects.current[key] = { x, y, w: width, h: height };
  };
  const periodGlideW0 = periodGlide?.w0 ?? 0;
  const periodGlideTransform = useMemo(
    () => (periodGlideW0 > 0
      ? [
          { translateX: Animated.subtract(Animated.multiply(Animated.add(periodL, periodR), 0.5), periodGlideW0 / 2) },
          { scaleX: Animated.divide(Animated.subtract(periodR, periodL), periodGlideW0) },
        ]
      : null),
    [periodL, periodR, periodGlideW0],
  );
  // intentTrialDays > 0 means the marketing handoff specified a trial —
  // surface trial framing near the CTA. Pre-selects + frames only.
  // Actual trial/purchase activation is the existing RevenueCat flow and
  // requires the RC webhook + real web key (owner task).
  const [intentTrialDays, setIntentTrialDays] = useState(0);

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

  // Consume the marketing-site signup intent (?plan=pro&trial=14).
  // Pre-select the matching plan and surface trial framing near the CTA.
  // Pre-selects + frames only. Actual trial/purchase activation is the
  // existing RevenueCat flow and requires the RC webhook + real web key (owner task).
  useEffect(() => {
    (async () => {
      const intent = await readSignupIntent();
      if (!intent) return;
      // Map the intent plan to the two plans this paywall supports.
      // enterprise → default to 'business' (closest available).
      // 'free' → no purchase intent here; don't consume the intent so
      // app/paywall.tsx (the comparison table) can still read it.
      if (intent.plan === 'free') return;
      if (intent.plan === 'pro') {
        setSelectedPlan('pro');
      } else if (intent.plan === 'business' || intent.plan === 'enterprise') {
        setSelectedPlan('business');
      }
      // trial framing — surface badge near CTA if trialDays > 0
      if (intent.trialDays > 0) {
        setIntentTrialDays(intent.trialDays);
      }
      await clearSignupIntent();
    })();
  }, []);

  // #42: every figure comes from the store package or is not shown. This memo
  // used to print a hand-typed per-month annual figure ($23.20) and "SAVE 20%"
  // NEXT TO RevenueCat's real annual total ($289.99 = $24.16/mo) — two
  // numbers on the first paid screen a new contractor sees that could not both
  // be true. Now the per-month figure is the annual package's price / 12,
  // floored to the cent in its own currency, and the savings percentage is
  // computed from the two packages (constants/pricing.ts). Missing package →
  // null → "Price shown at checkout" / no badge. The monthly list rate stays
  // as a labelled fallback: it is the published price, not a derived one.
  const pricing = useMemo(() => {
    const proMonthlyStore = proPackage?.product?.priceString ?? null;
    const businessMonthlyStore = businessPackage?.product?.priceString ?? null;
    return {
      proMonthly: proMonthlyStore ?? LIST_PRICE_MONTHLY.pro,
      proMonthlyIsList: proMonthlyStore === null,
      proAnnualPerMonth: annualPerMonth(proAnnualPackage?.product),
      proAnnualTotal: proAnnualPackage?.product?.priceString ?? null,
      proSavePct: annualSavingsPercent(proPackage?.product, proAnnualPackage?.product),
      businessMonthly: businessMonthlyStore ?? LIST_PRICE_MONTHLY.business,
      businessMonthlyIsList: businessMonthlyStore === null,
      businessAnnualPerMonth: annualPerMonth(businessAnnualPackage?.product),
      businessAnnualTotal: businessAnnualPackage?.product?.priceString ?? null,
      businessSavePct: annualSavingsPercent(businessPackage?.product, businessAnnualPackage?.product),
    };
  }, [proPackage, proAnnualPackage, businessPackage, businessAnnualPackage]);
  const savePct = selectedPlan === 'pro' ? pricing.proSavePct : pricing.businessSavePct;

  /**
   * Where every exit from this screen lands.
   *
   * Shared by decline, purchase and restore on purpose: the contractor who PAYS
   * has the same claim on seeing the project he just built as the one who
   * declines, and routing only the decline would have dropped the buyer on
   * Summary — which reads "No projects yet" until the context rehydrates.
   */
  const leaveToNextScreen = useCallback(async () => {
    // #70: this screen is exempt from the root gate, but the screens it opens
    // are not. The wizard hand-off already set the flag; if anything reached
    // here without it, set it BEFORE leaving so the onboarding gate cannot
    // fire on the way out and throw him back to the start of the funnel.
    if (hasSeenOnboarding !== true) {
      try { await completeOnboarding(); } catch (err) { console.warn('[onboarding-paywall] completeOnboarding failed', err); }
    }
    if (projectId) {
      // #70: REPLACE onto the tab shell, then PUSH the project — the same
      // sequence as onboarding.tsx's sample tour (UX-F18). Every hop into this
      // screen (login → persona → onboarding → wizard → here) was a replace,
      // so the root stack held ONE entry; a bare replace onto /project-detail
      // left a stack of one outside (tabs): no back chevron, no tab bar, no
      // way to Home without killing the app — for the buyer as much as the
      // decliner, since all three exits share this function.
      router.replace('/(tabs)/(home)' as never);
      router.push({ pathname: '/project-detail', params: { id: projectId } } as never);
      return;
    }
    router.replace('/(tabs)/summary' as never);
  }, [router, projectId, hasSeenOnboarding, completeOnboarding]);

  const handleClose = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    // Stamp last-seen so today's gate doesn't immediately re-show on next boot.
    void AsyncStorage.setItem(STORAGE_KEY_LAST_SEEN, new Date().toISOString());
    void leaveToNextScreen();
  }, [leaveToNextScreen]);

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
      showAlert(
        'Welcome to MAGE ID ' + (selectedPlan === 'pro' ? 'Pro' : 'Business') + '!',
        'Your subscription is active.',
      );
      void leaveToNextScreen();
    } catch (err: unknown) {
      const cancelled =
        err &&
        typeof err === 'object' &&
        'userCancelled' in err &&
        (err as { userCancelled: boolean }).userCancelled;
      if (cancelled) return;
      console.log('[OnboardingPaywall] purchase failed', err);
      showAlert(
        'Purchase Failed',
        'Something went wrong. Please try again, or tap Restore if you already purchased.',
      );
    }
  }, [selectedPlan, selectedPeriod, purchasePro, purchaseBusiness, leaveToNextScreen]);

  // #126: Restore used to announce "Your purchases have been restored" and
  // LEAVE the screen whenever the call returned — including when the store
  // found nothing — and labelled network failures "Nothing to Restore". Only a
  // restored paid tier leaves; everything else says what happened and stays.
  const handleRestore = useCallback(async () => {
    const store = Platform.OS === 'android' ? 'Google Play' : 'App Store';
    let result: unknown;
    try {
      result = await restorePurchases();
    } catch (err) {
      console.log('[OnboardingPaywall] restore failed', err);
      result = err;
    }
    const outcome = restoreOutcome(result, store);
    showAlert(outcome.title, outcome.body);
    if (outcome.leave) void leaveToNextScreen();
  }, [restorePurchases, leaveToNextScreen]);

  const openLegal = useCallback((kind: 'privacy' | 'terms') => {
    // Production domain is mageid.app, not mageid.com. Apple/Play
    // review will visit these URLs and reject the listing if the
    // links 404 or land on someone else's site.
    const url =
      kind === 'privacy'
        ? 'https://mageid.app/privacy'
        : 'https://mageid.app/terms';
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
    const pro = selectedPlan === 'pro';
    if (selectedPeriod === 'annual') {
      const perMonth = pro ? pricing.proAnnualPerMonth : pricing.businessAnnualPerMonth;
      const total = pro ? pricing.proAnnualTotal : pricing.businessAnnualTotal;
      return perMonth && total
        ? `${perMonth}/mo · billed annually (${total}/yr)`
        : `Billed annually · ${PRICE_AT_CHECKOUT.toLowerCase()}`;
    }
    const monthly = pro ? pricing.proMonthly : pricing.businessMonthly;
    const isList = pro ? pricing.proMonthlyIsList : pricing.businessMonthlyIsList;
    return isList
      ? `${monthly}/mo list price · billed monthly · exact price shown at checkout`
      : `${monthly}/mo · billed monthly`;
  }, [selectedPlan, selectedPeriod, pricing]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header: brand lockup + close */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandBadge}>
            <HardHat size={14} color={themeColors.accent} strokeWidth={2.4} />
          </View>
          <Text style={styles.brandName}>MAGE ID</Text>
        </View>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={handleClose}
          testID="onboarding-paywall-close" accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={themeColors.textSecondary} strokeWidth={1.75} /></TouchableOpacity>
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
              colors={[themeColors.accent, themeColors.accent + '55']}
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
                          i % 2 === 0 ? themeColors.accent : themeColors.accent + 'DD',
                      },
                    ]}
                  >
                    <Icon size={16} color={'#FFFFFF'} strokeWidth={2.2} />
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
          {periodGlide && periodGlideTransform ? (
            <Animated.View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.periodOptionActive,
                {
                  position: 'absolute',
                  left: 0,
                  top: periodGlide.to.y,
                  width: periodGlide.w0,
                  height: periodGlide.to.h,
                  borderRadius: styles.periodOption.borderRadius,
                  transform: periodGlideTransform,
                },
              ]}
            />
          ) : null}
          <TouchableOpacity
            onLayout={measurePeriod('annual')}
            style={[
              styles.periodOption,
              selectedPeriod === 'annual' && !periodGlide && styles.periodOptionActive,
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
            {/* Computed from the selected plan's two store packages; hidden
                when either is missing rather than printing a typed 20%. */}
            {savePct !== null && (
              <View style={styles.saveBadge}>
                <Text style={styles.saveBadgeText}>{`SAVE ${savePct}%`}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onLayout={measurePeriod('monthly')}
            style={[
              styles.periodOption,
              selectedPeriod === 'monthly' && !periodGlide && styles.periodOptionActive,
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
                ? (pricing.proAnnualTotal ? `${pricing.proAnnualTotal}/yr` : 'billed annually')
                : (pricing.proMonthlyIsList ? 'list price, monthly' : 'billed monthly')
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
            tagline={`Teams · ${INCLUDED_ADMIN_SEATS.business} office seats`}
            priceTop={
              selectedPeriod === 'annual'
                ? pricing.businessAnnualPerMonth
                : pricing.businessMonthly
            }
            priceBottom={
              selectedPeriod === 'annual'
                ? (pricing.businessAnnualTotal ? `${pricing.businessAnnualTotal}/yr` : 'billed annually')
                : (pricing.businessMonthlyIsList ? 'list price, monthly' : 'billed monthly')
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

        {intentTrialDays > 0 && (
          <View style={styles.trialBadge}>
            <Text style={styles.trialBadgeText}>{intentTrialDays}-day free trial</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.cta, (isPurchasing || isLoading) && styles.ctaDisabled]}
          onPress={handlePurchase}
          disabled={isPurchasing || isLoading}
          activeOpacity={0.88}
          testID="onboarding-paywall-cta"
        >
          {(isPurchasing || isLoading) ? (
            <ActivityIndicator color={'#FFFFFF'} size="small" />
          ) : (
            <Text style={styles.ctaLabel}>{ctaLabel}</Text>
          )}
        </TouchableOpacity>

        {/* The only way past this screen used to be an unlabelled X in the top
            corner. A contractor who is not buying today should be able to READ
            his way out — and the free plan is a real plan, not a dead end. */}
        <TouchableOpacity
          onPress={handleClose}
          style={styles.declineBtn}
          activeOpacity={0.7}
          accessibilityRole="button"
          testID="onboarding-paywall-decline"
        >
          <Text style={styles.declineLabel}>Continue on the free plan</Text>
        </TouchableOpacity>

        <Text style={styles.reassurance}>
          Cancel anytime in Settings. No hidden fees.
        </Text>

        <View style={styles.legalRow}>
          <TouchableOpacity onPress={() => openLegal('privacy')}>
            <Text style={styles.legalLink}>Privacy</Text>
          </TouchableOpacity>
          {/* No store on web — restore happens in the phone app, and the
              full paywall already hides Restore there (#126). */}
          {Platform.OS !== 'web' && (
            <>
              <Text style={styles.legalDot}>·</Text>
              <TouchableOpacity onPress={handleRestore} testID="onboarding-paywall-restore">
                <Text style={styles.legalLink}>Restore</Text>
              </TouchableOpacity>
            </>
          )}
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
  /** null = the store has not given us this figure: "Price shown at checkout". */
  priceTop: string | null;
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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Native only (the web already glides border-colour through the global
  // :where() rule): on an `active` CHANGE after mount an accent ring
  // cross-fades over RING_MS — in as he picks the card (the border waits at
  // its resting colour under it), out as he leaves it. The ring unmounts on
  // its end, so at rest the tree is today's.
  const ring = useRef(new Animated.Value(active ? 1 : 0)).current;
  const [ringing, setRinging] = useState(false);
  const prevActiveRef = useRef(active);
  useLayoutEffect(() => {
    if (prevActiveRef.current === active) return;
    prevActiveRef.current = active;
    if (Platform.OS === 'web' || reducedMotion()) {
      ring.stopAnimation();
      setRinging(false);
      return;
    }
    ring.stopAnimation();
    ring.setValue(active ? 0 : 1);
    setRinging(true);
    Animated.timing(ring, {
      toValue: active ? 1 : 0, duration: RING_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
    }).start(({ finished }) => {
      if (finished) setRinging(false);
    });
  }, [active, ring]);
  useEffect(() => () => ring.stopAnimation(), [ring]);

  // The price cross-fades when the period swaps it.
  const priceFade = useSwapFade(priceTop ?? '');
  const PriceBlock = priceFade ? Animated.View : View;
  const priceBlockStyle = priceFade ? [styles.planPriceBlock, priceFade] : styles.planPriceBlock;

  return (
    <TouchableOpacity
      style={[styles.planCard, active && styles.planCardActive, ringing && active && { borderColor: themeColors.line }]}
      onPress={onPress}
      activeOpacity={0.85}
      testID={testID}
    >
      {/* First child, so the POPULAR badge still paints over it. */}
      {ringing ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -styles.planCard.borderWidth,
            left: -styles.planCard.borderWidth,
            right: -styles.planCard.borderWidth,
            bottom: -styles.planCard.borderWidth,
            borderWidth: styles.planCard.borderWidth,
            borderColor: themeColors.accent,
            borderRadius: styles.planCard.borderRadius,
            opacity: ring,
          }}
        />
      ) : null}
      {featured && (
        <View style={styles.popularBadge}>
          <Text style={styles.popularBadgeText}>POPULAR</Text>
        </View>
      )}
      <Text style={[styles.planLabel, active && styles.planLabelActive]}>{label}</Text>
      <Text style={styles.planTagline}>{tagline}</Text>
      {priceTop ? (
        <PriceBlock style={priceBlockStyle}>
          <Text style={[styles.planPriceTop, active && styles.planPriceTopActive]}>
            {priceTop}
          </Text>
          <Text style={styles.planPriceUnit}>/mo</Text>
        </PriceBlock>
      ) : (
        <PriceBlock style={priceBlockStyle}>
          <Text style={styles.planPriceUnit}>{PRICE_AT_CHECKOUT}</Text>
        </PriceBlock>
      )}
      <Text style={styles.planPriceBottom}>{priceBottom}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: t.surface,
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
    backgroundColor: t.accent + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    letterSpacing: 0.2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.panel,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 8,
    // Onboarding pricing: reading + two plan cards. Cap is a no-op on phone
    // and stops the cards smearing across a desktop monitor.
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center' as const,
  },
  hero: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800' as const,
    color: t.text,
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
    borderRadius: Tokens.radius.xl,
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
    borderRadius: Tokens.radius.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureCopy: {
    flex: 1,
    paddingTop: 2,
  },
  featureTitle: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    marginBottom: 3,
    letterSpacing: -0.2,
  },
  featureDesc: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
    lineHeight: 18,
  },
  periodToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Tokens.radius.card,
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
    backgroundColor: t.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  periodLabel: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  periodLabelActive: {
    color: t.text,
  },
  saveBadge: {
    backgroundColor: t.success + '25',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  saveBadgeText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: t.success,
    letterSpacing: 0.4,
  },
  planRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  planCard: {
    flex: 1,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1.5,
    borderColor: t.line,
    backgroundColor: t.surface,
    padding: 14,
    position: 'relative',
    minHeight: 140,
  },
  planCardActive: {
    borderColor: t.accent,
    backgroundColor: t.accent + '08',
  },
  popularBadge: {
    position: 'absolute',
    top: -9,
    right: 10,
    backgroundColor: t.accentFill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },
  popularBadgeText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: 0.6,
  },
  planLabel: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  planLabelActive: {
    color: t.accent,
  },
  planTagline: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
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
    color: t.text,
    letterSpacing: -0.6,
  },
  planPriceTopActive: {
    color: t.accent,
  },
  planPriceUnit: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    fontWeight: '600' as const,
  },
  planPriceBottom: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    marginTop: 2,
  },
  priceFootnote: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 14,
  },
  // Trial framing: shown above the CTA when the marketing intent carries
  // a non-zero trialDays value. Visual-only — purchase does NOT auto-start.
  trialBadge: {
    backgroundColor: t.successSoft,
    borderRadius: Tokens.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 5,
    alignSelf: 'center' as const,
    marginBottom: 10,
  },
  trialBadgeText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: t.success,
    letterSpacing: 0.2,
  },
  cta: {
    height: 54,
    borderRadius: Tokens.radius.lg,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: {
    opacity: 0.6,
  },
  ctaLabel: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: t.surface,
    letterSpacing: 0.1,
  },
  declineBtn: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  declineLabel: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  reassurance: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
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
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    fontWeight: '500' as const,
  },
  legalDot: {
    fontSize: Type.caption1.fontSize,
    color: t.textMuted,
  },
});
