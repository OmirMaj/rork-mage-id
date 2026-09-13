import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, ActivityIndicator,
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
import { showAlert } from '@/utils/alert';

// App Store / Play Store deep links — used by the web paywall to bounce
// users to mobile. App Store ID 6762229238 is from eas.json submit.production.
const IOS_APP_URL = 'https://apps.apple.com/app/id6762229238';
const ANDROID_APP_URL = 'https://play.google.com/store/apps/details?id=app.mageid.android';

// Accepts 'free' so callers can pass requiredTierFor(feature) straight through
// instead of hardcoding a literal. Hardcoding is what caused four screens to
// gate on a 'business' feature while advertising Pro — the contractor bought
// Pro, hit the identical wall, and had paid for nothing.
//
// 'free' is never a real paywall; it is rendered as nothing (see below).
type RequiredTier = 'free' | 'pro' | 'business' | 'enterprise';
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
  'AI Code Check (15/day) & Voice-to-Report',
  'Client Portal for your customers',
  'Lien Waivers, Proposals, Change Orders',
  'Equipment tracking & Price Alerts',
];

const BUSINESS_BENEFITS: string[] = [
  'Everything in Pro, plus:',
  // 'Unlimited' was wrong by a factor the buyer can hit: hooks/useTierAccess
  // FEATURE_LIMITS.ai_code_check_daily.business = 50 and app/(tabs)/construction-ai
  // enforces it. The Pro line above already quotes its own number; this one
  // promised no ceiling on the same screen that prints "Daily AI requests | 80".
  'AI Code Checks (50/day) & bid responses',
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

/**
 * What the blocked feature DOES, keyed on the `feature` string every caller
 * already passes.
 *
 * This modal is the most-rendered blocked state in the app — 65 screens under
 * app/ early-return it — and until now the only sentences on it were "Upgrade
 * Required" and a tier bullet list chosen purely by requiredTier. A GC who
 * tapped Morning Brief got "Upgrade Required" over bullets about code checks
 * and plan markup: nothing on the screen said what the Morning Brief was, so
 * the screen that has to earn $79/mo never made the argument. The pitch is
 * what leads now; the tier list stays, captioned as what ELSE comes with the
 * plan.
 *
 * A feature with no entry here still names itself (the heading below is the
 * `feature` string) — it just doesn't get the sentence. Better a missing line
 * than an invented claim, so add one only for a screen you have read.
 */
const FEATURE_PITCH: Record<string, string> = {
  // "one ACTIVE project at a time" would be the wrong promise: the cap counts
  // every project that is not a demo — app/(tabs)/(home)/index.tsx filters only
  // the 'Sample — ' prefix before calling canCreateProject — so finishing job one
  // does not free the slot. Say what the app enforces, not what reads better.
  'Unlimited Projects':
    'Free covers one project, and a job you have already finished still counts against it. Pro takes the cap off, so every job you win gets its own estimate, schedule, invoices and photos.',
  // Scoped to what utils/brief/composeBrief actually aggregates (schedule,
  // invoices, permits/inspections, deliveries, site access, closeout, expiring
  // certs). It is handed no margin verdict and — unless the caller passes them —
  // no RFIs, so "what's at risk" and "who owes you an answer" would be selling
  // the two categories the brief cannot see.
  'Morning Brief':
    "Reads every job before you're on site and hands you today's short list — the task that slipped, the invoice aging past due, the inspection this week, the certification about to lapse.",
  'Cost X-Ray':
    "Photograph the panel, the supply lines, the waste stack — MAGE flags the costly hidden conditions and prices each one as a contingency on your own learned costs, before you commit a number.",
  'Scan Anything':
    'Snap any document — a sub invoice, a COI, a business card, a permit — and it is read, checked with you, and filed to the right job.',
  'Plan Intelligence':
    'Reads a floor plan room by room into a priced estimate, and learns your prices from the corrections you make.',
  'AI Punch from Photos':
    'Walk the site with the camera. MAGE drafts the punch list from the photos and you review it before anything is saved.',
  'AI Drawing Analyzer':
    'Reads a drawing set and pulls out the scope, quantities and the questions worth asking before you bid it.',
  'AI Priced Estimate from Takeoff':
    'Turns takeoff quantities into a priced, line-item estimate using your cost book rather than a generic catalog.',
  'Visual Takeoff':
    'Measure areas and lengths on a plan on screen — no wheel, no scale ruler, no re-keying into a spreadsheet.',
  'AI Bid Leveling':
    'Lines up sub bids side by side on the same scope so the cheap number that excluded half the work stops looking cheap.',
  'Bid Advisor':
    'Take, hold or walk — a scored read on a bid from your own win/loss and margin history, with the price it would take to win it profitably.',
  'Win Optimizer':
    'The bid price that both wins and profits, learned from the jobs you actually won and lost.',
  'Smart Proposal':
    'Good / better / best options, priced from your costs, in a proposal you can send and track.',
  'MAGE bids for you':
    'Bids MAGE has already priced from your cost book, waiting for you to review and send.',
  'Job Costing':
    'Committed, actual and remaining cost per job, so you see the overrun while there is still time to act on it.',
  'Cash Flow Forecaster':
    "A week-by-week forecast of money in and money out across every job — the screen that tells you whether next month's payroll is covered.",
  'WIP Reporting':
    'Over- and under-billings and earned revenue across the portfolio — the schedule your bank and your surety ask for.',
  'Full Budget Dashboard (EVM)':
    'Earned-value tracking (CPI/SPI) on a job: how much of the budget is spent versus how much of the work is actually done.',
  'Invoicing':
    'Progress and final invoices off the estimate, with what is billed, unbilled and overdue in one place.',
  'Change Orders':
    'Price extra work, send it for approval, and keep the signed trail — so the change that gets argued about later is in writing.',
  'AIA G702/G703 Pay Applications':
    'G702/G703 pay applications populated from your invoices and schedule of values instead of retyped into a spreadsheet.',
  'Lien Waiver Manager':
    'Conditional and unconditional waivers generated and tracked per payment, so a missing waiver never holds a draw.',
  'Contracts':
    'Build the contract off the estimate and keep the signed version with the job.',
  'Client Portal':
    'A branded page your customer can open for progress, photos, approvals and payment — instead of texting you for an update.',
  'Subcontractor Portals':
    'Give each sub their own scope, drawings and requests so you stop forwarding the same email set five times.',
  'Prequal + COI Tracking':
    'Prequal packets and insurance certificates per sub, with expiry dates that surface before the sub is on site uninsured.',
  'COI Vault & Insurance Validator':
    'Every sub certificate in one vault, checked for the limits you require and flagged before it expires.',
  'Sub Scorecard':
    'Which subs are actually good — graded from your real job costs, schedule hits and change orders.',
  'Crew Time Tracking':
    'Crew hours by job and cost code, so labor lands in job costing instead of on a paper timesheet.',
  'Crew Management':
    'Worker profiles, ID verification and who is assigned to which job.',
  'Equipment Tracking':
    'What you own or rent, where it is, and what it is costing the job it sits on.',
  // No expiry claim: app/permits.tsx never reads a permit's expires date — the
  // only 'expir' in the file is the status list — so promising expiry tracking
  // here would be sold on this screen and missing on the next one.
  'Permits & Inspections':
    'Every permit and every inspection logged against the job it belongs to, so the filing is in one place instead of in the truck.',
  'Safety Management':
    'JHAs, toolbox talks, incidents, the hazard log, inspections and the OSHA log — the paperwork an inspector asks for, per job.',
  'Punch List & Closeout':
    'Walkthrough items with photos and owners, tracked to signed-off closeout.',
  'RFIs & Submittals':
    'RFIs and submittals with the clock running on each one, so the answer you are waiting on is visible instead of remembered.',
  'OAC Meetings':
    'Owner-architect-contractor meeting minutes with the follow-ups assigned and tracked.',
  'Last Planner':
    'A three-week lookahead with weekly commitments and the PPC score of whether the crew hit them.',
  'Schedule Pro (Gantt + CPM)':
    'A real critical-path schedule: dependencies, float, levelling, and a Gantt you can print for the trailer wall.',
  'Schedule Pro (Gantt + PDF Export)':
    'A real critical-path schedule: dependencies, float, levelling, and a Gantt you can print for the trailer wall.',
  'Plan Viewer':
    'Open the sheet set on site, zoom the detail, and pin photos and punch items to the spot on the drawing.',
  'Photo Markup':
    'Draw on a jobsite photo and send it, so the instruction is on the picture instead of in a paragraph.',
  'Photo Triage':
    'Bulk-sort the day’s photos to the right job and record, instead of leaving 300 shots in the camera roll.',
  'T&M Field Tickets':
    'Capture extra work and get it signed on site, before anyone forgets it happened.',
  'Material Receipt Capture':
    'Photograph a material receipt and it is coded to the job, so actual cost is not a shoebox at year end.',
  'Project Memory':
    "Ask this job's own records a question and get the answer with the report or RFI it came from.",
  'Cost Database':
    'Your own unit costs, learned from the jobs you close — the book every estimate here prices from.',
  'Seed Your Rates':
    'Type or paste the rates you already charge so your first estimates price from your numbers, not market averages.',
  'Living Estimate':
    'The estimate keeps updating as real cost posts, so you always know where the job stands against the number you sold.',
  'Estimate Confidence':
    'How much of this estimate rests on your own measured costs versus a catalog allowance, line by line.',
  'Estimate Accuracy':
    'Bid versus actual on your closed jobs — the measured accuracy of your own estimating.',
  'Estimate Scorecard':
    'Bid versus actual by category on closed jobs, so you can see where the money went.',
  'Estimate Calibration':
    'Where your bids run high or low by trade, and what to adjust.',
  'Track Record':
    'What MAGE predicted versus what happened, kept honest over time.',
  'Margin Alerts':
    'A warning when a job is trending toward losing money, while you can still do something about it.',
  'Margin Risk Score':
    'A scored read on which jobs are most likely to lose margin, and why.',
  'Portfolio Margin Board':
    'Margin across every job on one board, so the one bleeding is obvious.',
  'Profit Leak History':
    'The recurring leaks — the same missed allowance, the same unbilled extra — found across your closed jobs.',
  'Payment Predictions':
    'When each invoice is actually likely to be paid, based on how that client has paid before.',
  'Friday Close':
    'The end-of-week pass: bill what you earned, chase what you are owed, commit next week.',
  'Buyout Scope-Gap Audit':
    'Compares the sub scopes you bought against the estimate you sold, and names the work nobody has been hired to do.',
  'Construction AI':
    'Describe the job and get the likely codes, permits, inspections and common violations to avoid.',
  'Construction Answers':
    'Ask a construction question and get an answer with its sources, not a guess.',
  'Generative Project Setup':
    'Describe the job once and MAGE drafts the project, scope and starting schedule for you to edit.',
  'QuickBooks Sync':
    'Push invoices and costs to QuickBooks so your books and your jobs agree.',
  'QuickBooks Cost Review':
    'Review what QuickBooks has coded to each job before it lands in your job costs.',
  'Your Business':
    'The whole-company view: pipeline, margin, cash and what needs you, across every job.',
  // Keyed on the raw FeatureKey because that is what the caller passes — see
  // FEATURE_TITLE below.
  schedule_scenarios:
    'Snapshot the schedule, try the what-if, and switch between it and the baseline without touching the plan you committed to.',
};

/**
 * Display name for a caller that passes a FeatureKey instead of a label.
 *
 * components/schedule/ScenariosModal renders <Paywall feature="schedule_scenarios">,
 * and `feature` is printed as the heading — so the blocked state read
 * "schedule_scenarios | Requires Pro" at a contractor. Mapped, not transformed:
 * a generic snake_case→Title rewrite would also rewrite a real label the day one
 * happens to contain an underscore.
 */
const FEATURE_TITLE: Record<string, string> = {
  schedule_scenarios: 'Schedule Scenarios',
};

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
  // The one sentence about the thing he just tapped. Undefined for features
  // with no entry in FEATURE_PITCH — the heading still names them.
  const pitch = FEATURE_PITCH[feature];
  const featureTitle = FEATURE_TITLE[feature] ?? feature;
  // 'free' is not a purchasable tier and the component renders null for it —
  // but that return has to sit AFTER every hook (there is a useMemo just
  // below), so this lookup still needs a valid key. 'pro' is a placeholder
  // that is never rendered; see the early return further down.
  const paidTier: Exclude<RequiredTier, 'free'> =
    requiredTier === 'free' ? 'pro' : requiredTier;
  const fallback = FALLBACK_PRICES[paidTier];

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
      showAlert(`Welcome to ${tierLabel}!`, 'Your subscription is now active.');
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
        showAlert(
          `${tierLabel} isn’t available yet`,
          `The ${tierLabel} plan isn’t purchasable on your device right now. This usually means the plan is still being set up in the App Store. Try a lower tier, or email support@mageid.app and we’ll sort it out.`,
        );
      } else {
        showAlert('Purchase Failed', 'Could not complete the purchase. Please try again.');
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
  // A free feature cannot be paywalled. If a caller ever derives 'free' here,
  // the honest thing is to show nothing rather than a wall demanding payment
  // for something already included — a locked screen the user can never unlock
  // is worse than an unstyled one. Placed after every hook so hook order stays
  // unconditional.
  if (requiredTier === 'free') return null;

  if (Platform.OS === 'web') {
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleDismiss}>
        <View style={[styles.container, { paddingBottom: insets.bottom }]}>
          <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
            <View style={{ width: 36 }} />
            <Text style={styles.headerTitle}>Continue on Mobile</Text>
            <TouchableOpacity onPress={handleDismiss} style={styles.closeBtn} testID="paywall-modal-close-web" accessibilityRole="button" accessibilityLabel="Close"><X size={22} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={[styles.heroIconWrap, { backgroundColor: tierColor + '15' }]}>
              <Smartphone size={36} color={tierColor} strokeWidth={1.75} />
            </View>

            <Text style={styles.featureName}>{featureTitle}</Text>
            {pitch ? <Text style={styles.featurePitch}>{pitch}</Text> : null}
            <Text style={styles.requiresLine}>
              Requires <Text style={[styles.requiresTierEm, { color: tierColor }]}>{tierLabel}</Text>
            </Text>

            <Text style={styles.webExplain}>
              Subscriptions are managed in the MAGE ID mobile app. Once you upgrade
              there, your account will unlock {tierLabel} features everywhere —
              including back here on the web.
            </Text>

            <View style={styles.benefitsBox}>
              <Text style={styles.benefitsCaption}>What else comes with {tierLabel}</Text>
              {benefits.map((b, idx) => (
                <View key={idx} style={styles.benefitRow}>
                  <CheckCircle2 size={16} color={tierColor} strokeWidth={1.75} />
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
              <Apple size={18} color="#fff" strokeWidth={1.75} />
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
              <Smartphone size={18} color="#fff" strokeWidth={1.75} />
              <Text style={styles.upgradeBtnText}>Open in Google Play</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleDismiss} style={styles.notNowBtn} testID="paywall-not-now-web">
              <Text style={styles.notNowText}>Maybe later</Text>
            </TouchableOpacity>

            <View style={styles.trustRow}>
              <Shield size={13} color={themeColors.textSecondary} strokeWidth={1.75} />
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
          <TouchableOpacity onPress={handleDismiss} style={styles.closeBtn} testID="paywall-modal-close" accessibilityRole="button" accessibilityLabel="Close"><X size={22} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={[styles.heroIconWrap, { backgroundColor: tierColor + '15' }]}>
            <TierIcon size={36} color={tierColor} />
          </View>

          <Text style={styles.featureName}>{featureTitle}</Text>
          {pitch ? <Text style={styles.featurePitch}>{pitch}</Text> : null}
          <Text style={styles.requiresLine}>
            Requires <Text style={[styles.requiresTierEm, { color: tierColor }]}>{tierLabel}</Text>
          </Text>

          <View style={styles.benefitsBox}>
            {/* Captioned because it is NOT a description of `feature` — it is
                the plan's contents, chosen by tier. Uncaptioned, a GC who
                tapped Morning Brief read these bullets as the answer to
                "what am I buying?" and they are about other screens. */}
            <Text style={styles.benefitsCaption}>What else comes with {tierLabel}</Text>
            {benefits.map((b, idx) => (
              <View key={idx} style={styles.benefitRow}>
                <CheckCircle2 size={16} color={tierColor} strokeWidth={1.75} />
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
            <Shield size={13} color={themeColors.textSecondary} strokeWidth={1.75} />
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
  featurePitch: {
    fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, lineHeight: 21,
    textAlign: 'center', marginTop: 6, marginBottom: 10,
  },
  requiresLine: { fontSize: Type.subhead.fontSize, color: t.textSecondary, marginBottom: 22 },
  benefitsCaption: {
    fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '700' as const,
    letterSpacing: 0.6, textTransform: 'uppercase' as const,
  },
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
