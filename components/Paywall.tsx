import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, ActivityIndicator, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Crown, Building2, CheckCircle2, X, Shield, Smartphone, Apple, CirclePlay } from 'lucide-react-native';
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
import {
  LIST_PRICE_MONTHLY, PRICE_AT_CHECKOUT, annualPerMonth, annualSavingsAmount, annualSavingsPercent,
} from '@/constants/pricing';
import { planFeatureLines } from '@/utils/planFeatureCopy';
import type { StartCtx, TutorialId } from '@/utils/tutorial/types';
import { getTutorialState, startTutorial, useTutorialRun } from '@/utils/tutorial/store';
import { resumeTarget } from '@/utils/tutorial/machine';
import { TUTORIAL_DEFS } from '@/utils/tutorial/defs';
import { useTutorialProgress } from '@/utils/tutorial/progress';
import { chipReturnTo } from '@/utils/tutorial/entryPoints';
import { useGlobalSearchParams, usePathname } from 'expo-router';
import { paywallPracticeOffer, restoredRunId, runBlocksPaywallOffer } from '@/utils/paywallPracticeOffer';
import { segmentedDesktop, useIsDesktop } from '@/components/ui';
import { SheetOverlay, useSheetFrame } from '@/components/ui/Sheet';

// resumeTarget() needs a StartCtx only to build params; handlePracticeFirst
// reads just whether it is null, so any fixed dates do.
const RESUME_PROBE_CTX: StartCtx = { today: '1970-01-01', reportDay: '1970-01-01' };

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
  /**
   * The tutorial that practises this feature on the SAMPLE job (punch walk,
   * invoicing). When set, the practice pass is on and he has not practised it
   * yet, the wall offers "Try it free on a sample job first" under the plans —
   * so a Free user feels the feature before being asked to buy it. Tapping it
   * closes the wall (the caller's own onClose) and starts the tutorial.
   */
  practiceTutorialId?: TutorialId;
  /**
   * Which surface opened this wall ('tutorial_handoff' from a tutorial's
   * finale, …). Passed into PAYWALL_VIEWED so the funnel can split the
   * practice → paywall → purchase path from every other gate.
   */
  source?: string;
}

// A live run is running (or paused) — the offer hides then, so a wall met
// mid-tutorial never ends the run he is in. A RESTORED run is the exception
// (utils/paywallPracticeOffer): it holds no pass, so this wall is what a web
// reload of the sample's gated screen shows, and the offer is its Resume.
const selectRunActive = runBlocksPaywallOffer;
const selectRestoredId = restoredRunId;

// Prices: RevenueCat's package when loaded, else the published list rate from
// constants/pricing.ts — the ONE fallback table (#42). This file used to carry
// its own ($29.99 / $289.99 / "$24.16"), which disagreed with app/paywall.tsx
// ($29) and the onboarding paywall ($29.00, $23.20), so one contractor offline
// could read three prices for Pro. No annual figure is typed anywhere: annual
// totals, the per-month equivalent and the savings come from the store or are
// not shown.

// What else the plan includes. #125: these lists were hand-typed and sold Plan
// Viewer and RFIs/Submittals as Business (both unlock on Pro), while the Pro
// list sold Daily Field Reports and Price Alerts, which are open on Free — a
// $29 buyer steered to $79. The lines now come from utils/planFeatureCopy,
// which places each one by REQUIRED_TIER. Only 'Unlimited projects' is typed
// here: it is hooks/useTierAccess maxProjects, not a FeatureKey.
const PRO_BENEFITS: string[] = [
  'Unlimited projects',
  ...planFeatureLines('pro'),
];

const BUSINESS_BENEFITS: string[] = [
  'Everything in Pro, plus:',
  ...planFeatureLines('business'),
];

const ENTERPRISE_BENEFITS: string[] = [
  'Everything in Business, plus:',
  'Highest AI usage limits',
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
  // "one ACTIVE project at a time" would be the wrong promise. What the cap
  // counts is the live server rule (enforce_free_tier_project_cap): every
  // non-sample project you OWN, finished or not — so finishing job one does
  // not free the slot. Jobs another contractor shares with you are theirs and
  // do not count. A job won through the RFP marketplace DOES count once it
  // exists (the server exempts only the award's own insert) — so never say
  // awarded jobs are free (productDecision #127). Say what the app enforces,
  // not what reads better.
  'Unlimited Projects':
    'Free covers one project of your own, and a project you have already finished still counts against it (projects other contractors share with you don’t). Pro takes the cap off, so every project you win gets its own estimate, schedule, invoices and photos.',
  // Scoped to what utils/brief/composeBrief actually aggregates (schedule,
  // invoices, permits/inspections, deliveries, site access, closeout, expiring
  // certs). It is handed no margin verdict and — unless the caller passes them —
  // no RFIs, so "what's at risk" and "who owes you an answer" would be selling
  // the two categories the brief cannot see.
  'Morning Brief':
    "Reads every project before you're on site and gives you today's short list: the task that slipped, the invoice aging past due, the inspection this week, the certification about to lapse.",
  'Cost X-Ray':
    "Photograph the panel, the supply lines and the waste stack. MAGE flags costly hidden conditions and prices each one as a contingency from your cost history, before you commit a number.",
  'Scan Anything':
    'Snap any document, like a sub invoice, a COI, a business card or a permit. It is read, checked with you and filed to the right project.',
  'Plan Intelligence':
    'Reads a floor plan room by room into a priced estimate, and learns your prices from the corrections you make.',
  'AI Punch from Photos':
    'Walk the jobsite with the camera. MAGE drafts the punch list from the photos, and you review it before anything is saved.',
  'AI Drawing Analyzer':
    'Reads a plan set and pulls out the scope, quantities and the questions worth asking before you bid it.',
  'AI Priced Estimate from Takeoff':
    'Turns takeoff quantities into a priced, line-item estimate from your cost history rather than a generic catalog.',
  'Visual Takeoff':
    'Measure areas and lengths on a plan on screen. No wheel, no scale ruler, no re-keying into a spreadsheet.',
  'AI Bid Leveling':
    'Lines up sub bids side by side on the same scope so the cheap number that excluded half the work stops looking cheap.',
  'Bid Advisor':
    'Take, hold or walk: a scored read on a bid from your own win/loss and margin history, with the price it would take to win it profitably.',
  'Win Optimizer':
    'The bid price that both wins and profits, learned from the projects you won and lost.',
  'Smart Proposal':
    'Good, better and best options, priced from your costs, in a proposal you can send and track.',
  'MAGE bids for you':
    'Bids MAGE has already priced from your cost history, waiting for you to review and send.',
  'Job Costing':
    'Committed, actual and remaining cost per project, so you see the overrun while there is still time to act on it.',
  'Cash Flow Forecaster':
    "A week-by-week forecast of money in and money out across every project. It tells you whether next month's payroll is covered.",
  'WIP Reporting':
    'Over- and under-billings and earned revenue across the portfolio: the schedule your bank and your surety ask for.',
  'Full Budget Dashboard (EVM)':
    'Earned-value tracking (CPI/SPI) on a project: how much of the budget is spent against how much of the work is done.',
  'Invoicing':
    'Progress and final invoices off the estimate, with what is billed, unbilled and overdue in one place.',
  'Change Orders':
    'Price extra work, send it for approval and keep the signed trail, so the change that gets argued about later is in writing.',
  'AIA G702/G703 Pay Applications':
    'G702/G703 pay apps filled from your invoices and schedule of values instead of retyped into a spreadsheet.',
  'Lien Waiver Manager':
    'Conditional and unconditional waivers generated and tracked per payment, so a missing waiver never holds a draw.',
  'Contracts':
    'Build the contract from the estimate and keep the signed version with the project.',
  'Client Portal':
    'A branded page your client can open for progress, photos, approvals and payment, instead of texting you for an update.',
  'Subcontractor Portals':
    'Give each sub their own scope, plans and requests so you stop forwarding the same email five times.',
  'Prequal + COI Tracking':
    'Prequal packets and insurance certificates per sub, with expiry dates that surface before the sub is on site uninsured.',
  // ('COI Vault & Insurance Validator' left in wave 5: no screen passes it any
  // more — the vault uses 'Prequal + COI Tracking' — and "checked for the
  // limits you require" promised a check an unconfirmed AI read doesn't make.)
  'Sub Scorecard':
    'Which subs perform, graded from your job costs, schedule hits and change orders.',
  'Crew Time Tracking':
    'Crew hours by project and cost code, so labor lands in job costing instead of on a paper timesheet.',
  'Crew Management':
    'Crew member profiles, ID verification and who is assigned to which project.',
  'Equipment Tracking':
    'What you own or rent, where it is, and what it costs the project it sits on.',
  // No expiry claim: app/permits.tsx never reads a permit's expires date — the
  // only 'expir' in the file is the status list — so promising expiry tracking
  // here would be sold on this screen and missing on the next one.
  'Permits & Inspections':
    'Every permit and inspection logged against its project, so the filing is in one place instead of in the truck.',
  'Safety Management':
    'JHAs, toolbox talks, incidents, the hazard log, inspections and the OSHA log: the paperwork an inspector asks for, per project.',
  'Punch List & Closeout':
    'Walkthrough items with photos and owners, tracked to signed-off closeout.',
  'RFIs & Submittals':
    'RFIs and submittals with the clock running on each one, so the answer you are waiting on is visible instead of remembered.',
  'OAC Meetings':
    'Owner-architect-contractor meeting minutes with the follow-ups assigned and tracked.',
  'Last Planner':
    'A three-week lookahead with weekly commitments and the PPC score of whether the crew hit them.',
  'Schedule Pro (Gantt + CPM)':
    'A critical-path schedule with dependencies, float and leveling, and a Gantt you can print for the trailer wall.',
  'Schedule Pro (Gantt + PDF Export)':
    'A critical-path schedule with dependencies, float and leveling, and a Gantt you can print for the trailer wall.',
  'Plan Viewer':
    'Open the sheet set on site, zoom the detail, and pin photos and punch items to the spot on the sheet.',
  'Photo Markup':
    'Draw on a jobsite photo and send it, so the instruction is on the picture instead of in a paragraph.',
  'Photo Triage':
    'Bulk-sort the day’s photos to the right project and record, instead of leaving 300 shots in the camera roll.',
  'T&M Field Tickets':
    'Capture extra work and get it signed on site, before anyone forgets it happened.',
  'Material Receipt Capture':
    'Photograph a material receipt and it is coded to the project, so actual cost is not a shoebox at year end.',
  'Project Memory':
    "Ask this project's own records a question and get the answer with the report or RFI it came from.",
  'Cost Database':
    'Your own unit costs, learned from the projects you close. Every estimate here prices from them.',
  'Seed Your Rates':
    'Type or paste the rates you already charge so your first estimates price from your numbers, not market averages.',
  'Living Estimate':
    'The estimate updates as cost posts, so you always know where the project stands against the number you sold.',
  'Estimate Confidence':
    'How much of this estimate rests on your own measured costs versus a catalog allowance, line by line.',
  'Estimate Accuracy':
    'Bid against actual on your closed projects: the measured accuracy of your own estimating.',
  'Estimate Scorecard':
    'Bid against actual by category on closed projects, so you can see where the money went.',
  'Estimate Calibration':
    'Where your bids run high or low by trade, and what to adjust.',
  'Track Record':
    'What MAGE predicted against what each project cost.',
  'Margin Alerts':
    'A warning when a project is trending toward losing money, while you can still act on it.',
  'Margin Risk Score':
    'A scored read on which projects are most likely to lose margin, and why.',
  'Portfolio Margin Board':
    'Margin across every project on one board, so the one losing money is obvious.',
  'Profit Leak History':
    'The recurring leaks found across your closed projects: the same missed allowance, the same unbilled extra.',
  'Payment Predictions':
    'When each invoice is actually likely to be paid, based on how that client has paid before.',
  'Friday Close':
    'The end-of-week pass: bill what you earned, chase what you are owed, commit next week.',
  'Buyout Scope-Gap Audit':
    'Compares the sub scopes you bought against the estimate you sold, and names the work nobody has been hired to do.',
  'Construction AI':
    'Describe the project and get the likely codes, permits, inspections and common violations to avoid.',
  'Construction Answers':
    'Ask a construction question. Answers cite their sources.',
  'Generative Project Setup':
    'Describe the project once and MAGE drafts it, with scope and a starting schedule for you to edit.',
  'QuickBooks Sync':
    'Push invoices and costs to QuickBooks so your books and your projects agree.',
  'QuickBooks Cost Review':
    'Review what QuickBooks has coded to each project before it lands in your job costs.',
  'Your Business':
    'The whole-company view: pipeline, margin, cash and what needs you, across every project.',
  // Keyed on the raw FeatureKey because that is what the caller passes — see
  // FEATURE_TITLE below.
  schedule_scenarios:
    // #53: a saved plan is a frozen copy — nothing edits it — so this no
    // longer sells "try the what-if" modelling the feature cannot do.
    'Save frozen copies of the schedule to look back at or restore, without touching the plan you are working in.',
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
  schedule_scenarios: 'Saved schedule plans',
  // Callers pass Title Case feature strings (they double as FEATURE_PITCH keys
  // and analytics props, so they stay as they are at the call site). The
  // heading prints the sentence-case name from this map; an unmapped string
  // still prints as passed.
  'Unlimited Projects': 'Unlimited projects',
  'Photo Code Look': 'Photo code look',
  'Inspection Ready commonly-checked list': 'Inspection checklist',
  'Morning Brief': 'Morning brief',
  'Scan Anything': 'Scan anything',
  'Plan Intelligence': 'Plan intelligence',
  'AI Punch from Photos': 'AI punch items from photos',
  'AI Drawing Analyzer': 'AI plan analysis',
  'AI Priced Estimate from Takeoff': 'Priced estimate from takeoff',
  'Visual Takeoff': 'Visual takeoff',
  'AI Bid Leveling': 'Bid leveling',
  'Bid Advisor': 'Bid advisor',
  'Win Optimizer': 'Win optimizer',
  'Smart Proposal': 'Smart proposal',
  'Job Costing': 'Job costing',
  'Cash Flow Forecaster': 'Cash-flow forecast',
  'WIP Reporting': 'WIP reporting',
  'Full Budget Dashboard (EVM)': 'Full budget dashboard (EVM)',
  'Change Orders': 'Change orders',
  'AIA G702/G703 Pay Applications': 'AIA G702/G703 pay apps',
  'Lien Waiver Manager': 'Lien waivers',
  'Client Portal': 'Client portal',
  'Subcontractor Portals': 'Sub portals',
  'Prequal + COI Tracking': 'Prequal and COI tracking',
  'Sub Scorecard': 'Sub scorecard',
  'Crew Time Tracking': 'Crew time tracking',
  'Crew Management': 'Crew management',
  'Equipment Tracking': 'Equipment tracking',
  'Permits & Inspections': 'Permits and inspections',
  'Safety Management': 'Safety management',
  'Punch List & Closeout': 'Punch list and closeout',
  'RFIs & Submittals': 'RFIs and submittals',
  'OAC Meetings': 'OAC meetings',
  'Schedule Pro (Gantt + CPM)': 'Schedule Pro (Gantt and CPM)',
  'Schedule Pro (Gantt + PDF Export)': 'Schedule Pro (Gantt and PDF export)',
  'Plan Viewer': 'Plan viewer',
  'Photo Markup': 'Photo markup',
  'Photo Triage': 'Photo triage',
  'T&M Field Tickets': 'T&M tickets',
  'Material Receipt Capture': 'Material receipt capture',
  'Project Memory': 'Project memory',
  'Cost Database': 'Cost history',
  'Seed Your Rates': 'Add your rates',
  'Living Estimate': 'Living estimate',
  'Estimate Confidence': 'Estimate confidence',
  'Estimate Accuracy': 'Estimate accuracy',
  'Estimate Scorecard': 'Estimate scorecard',
  'Estimate Calibration': 'Estimate calibration',
  'Track Record': 'Track record',
  'Margin Alerts': 'Margin alerts',
  'Margin Risk Score': 'Margin risk score',
  'Portfolio Margin Board': 'Portfolio margin board',
  'Profit Leak History': 'Profit leak history',
  'Payment Predictions': 'Payment predictions',
  'Friday Close': 'Friday close',
  'Buyout Scope-Gap Audit': 'Buyout scope-gap audit',
  'Construction Answers': 'Construction answers',
  'Generative Project Setup': 'Project setup from a description',
  'QuickBooks Sync': 'QuickBooks sync',
  'QuickBooks Cost Review': 'QuickBooks cost review',
  'Your Business': 'Your business',
};

export default function Paywall({ visible, onClose, feature, requiredTier, practiceTutorialId, source }: PaywallProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const isDesktop = useIsDesktop();
  // Wave 6d: on desktop the WEB wall is a centred card over a scrim (it was an
  // opaque full-window page whose "Open in App Store" button measured ~1,470
  // px). On a phone the frame is all-null: the web Modal keeps today's props.
  const pw = useSheetFrame('form', { visible, animationType: 'slide' });
  const [period, setPeriod] = useState<BillingPeriod>('annual');

  // ── Monetization funnel: top-of-funnel impression ──
  // Fires every time the modal becomes visible. Tagged with the feature
  // that triggered the gate + the tier blocked, so PostHog can split
  // funnels by which gate produces conversion.
  useEffect(() => {
    if (!visible) return;
    track(AnalyticsEvents.PAYWALL_VIEWED, { feature, tier_blocked: requiredTier, ...(source ? { source } : {}) });
  }, [visible, feature, requiredTier, source]);

  // "Try it free on a sample job first" (utils/paywallPracticeOffer decides).
  const { progress: tutorialProgress, loaded: tutorialProgressLoaded } = useTutorialProgress();
  const tutorialRunActive = useTutorialRun(selectRunActive);
  const restoredTutorialId = useTutorialRun(selectRestoredId);
  const practiceOffer = useMemo(() => paywallPracticeOffer({
    tutorialId: practiceTutorialId,
    progress: tutorialProgress,
    progressLoaded: tutorialProgressLoaded,
    runActive: tutorialRunActive,
    restoredTutorialId,
  }), [practiceTutorialId, tutorialProgress, tutorialProgressLoaded, tutorialRunActive, restoredTutorialId]);
  const offeredTutorialId = visible ? practiceOffer?.tutorialId ?? null : null;
  useEffect(() => {
    if (!offeredTutorialId) return;
    track(AnalyticsEvents.TUTORIAL_OFFERED, { tutorial_id: offeredTutorialId, entry: 'paywall' });
  }, [offeredTutorialId]);

  // Wrap every dismissal path so paywall_dismissed always fires.
  // Pair with paywall_viewed → bounce rate. Pair with started/completed
  // → conversion rate. Without this, every "user bailed" path is silent.
  const handleDismiss = useCallback(() => {
    track(AnalyticsEvents.PAYWALL_DISMISSED, { feature });
    onClose();
  }, [feature, onClose]);

  // The wall closes through the caller's own onClose (a gated screen pops
  // itself), THEN the tutorial starts: the host seeds the sample and pushes
  // the sample hub + screen on top of wherever that leaves him, and the
  // practice pass opens the feature on the sample only.
  // returnTo is the gated screen he tried to open (with its params, e.g. his
  // real job), so the finale's Done lands him back where he started instead
  // of wherever the pop left him.
  const pathname = usePathname();
  const routeParams = useGlobalSearchParams();
  const handlePracticeFirst = useCallback(() => {
    if (!practiceOffer) return;
    track(AnalyticsEvents.PAYWALL_DISMISSED, { feature, kind: 'practice_sample' });
    // Resuming a RESTORED run of this tutorial. One rule, read from the same
    // function the host resumes with: if resumeTarget() is null the run's
    // checkpoint IS this screen (a web reload of the sample's /invoice), so do
    // NOT pop: Resume lifts the pause, the pass comes back and the gate
    // re-renders into the editor right here (popping first raced the host,
    // which still saw the popped route as "already there" and never navigated,
    // integration review round 2). Otherwise this wall is on a real job or on
    // /punch-list, the host will PUSH the sample screens over it, and a wall
    // left mounted underneath keeps its <Modal visible> presented over the
    // tutorial on iOS and web (round 3). So pop first, as before. The ctx only
    // feeds params; only null-or-not matters here.
    if (restoredTutorialId === practiceOffer.tutorialId) {
      const inPlace = resumeTarget(getTutorialState(), TUTORIAL_DEFS, RESUME_PROBE_CTX) === null;
      if (!inPlace) onClose();
      void startTutorial(practiceOffer.tutorialId, { entry: 'paywall' });
      return;
    }
    const returnTo = chipReturnTo(pathname, routeParams as Record<string, string | string[] | undefined>);
    onClose();
    void startTutorial(practiceOffer.tutorialId, { entry: 'paywall', returnTo });
  }, [practiceOffer, restoredTutorialId, feature, onClose, pathname, routeParams]);

  const practiceBlock = practiceOffer ? (
    <View style={styles.practiceWrap}>
      <TouchableOpacity
        style={styles.practiceBtn}
        onPress={handlePracticeFirst}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={practiceOffer.label}
        testID="paywall-practice-sample"
      >
        <CirclePlay size={18} color={themeColors.text} strokeWidth={1.75} />
        <Text style={styles.practiceBtnText}>{practiceOffer.label}</Text>
      </TouchableOpacity>
      <Text style={styles.practiceSub}>{practiceOffer.sub}</Text>
    </View>
  ) : null;

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

  const pricing = useMemo(() => {
    const monthlyPkg = paidTier === 'enterprise' ? enterprisePackage
      : paidTier === 'business' ? businessPackage
      : proPackage;
    const annualPkg = paidTier === 'enterprise' ? enterpriseAnnualPackage
      : paidTier === 'business' ? businessAnnualPackage
      : proAnnualPackage;

    const monthlyStore = monthlyPkg?.product?.priceString ?? null;
    return {
      // The published list rate while the store price is unavailable — labelled
      // as a list price below, never passed off as the store's figure.
      monthlyPrice: monthlyStore ?? LIST_PRICE_MONTHLY[paidTier],
      monthlyIsList: monthlyStore === null,
      annualPrice: annualPkg?.product?.priceString ?? null,
      // annual price / 12, floored to the cent, in the store's own format.
      monthlyEquivalent: annualPerMonth(annualPkg?.product),
      savePct: annualSavingsPercent(monthlyPkg?.product, annualPkg?.product),
      saveAmount: annualSavingsAmount(monthlyPkg?.product, annualPkg?.product),
    };
  }, [paidTier, proPackage, proAnnualPackage, businessPackage, businessAnnualPackage, enterprisePackage, enterpriseAnnualPackage]);

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
      showAlert(`You're on ${tierLabel}`, `Every ${tierLabel} feature is on for your account.`);
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
          `The ${tierLabel} plan can’t be bought on this device yet. It is usually still being set up in the App Store. Choose another plan, or email support@mageid.app and we’ll set it up.`,
        );
      } else {
        showAlert("Couldn't complete purchase", "The purchase didn't go through. Try again.");
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
      <Modal visible={visible} transparent={pw.isDesktop || undefined} animationType={pw.animationType} presentationStyle={pw.isDesktop ? undefined : 'pageSheet'} onRequestClose={handleDismiss}>
        <SheetOverlay frame={pw}>
        {pw.isDesktop ? <Pressable style={[styles.webScrim, pw.backdrop]} onPress={handleDismiss} accessibilityRole="button" accessibilityLabel="Close" /> : null}
        <View style={[styles.container, { paddingBottom: insets.bottom }, pw.card, pw.isDesktop && styles.webCardDesktop]}>
          <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
            <View style={{ width: 36 }} />
            <Text style={styles.headerTitle}>Continue on mobile</Text>
            <TouchableOpacity onPress={handleDismiss} style={styles.closeBtn} testID="paywall-modal-close-web" accessibilityRole="button" accessibilityLabel="Close"><X size={22} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={[styles.heroIconWrap, { backgroundColor: tierColor + '15' }]}>
              <Smartphone size={36} color={tierColor} strokeWidth={1.75} />
            </View>

            <Text style={styles.featureName}>{featureTitle}</Text>
            {pitch ? <Text style={styles.featurePitch}>{pitch}</Text> : null}
            <Text style={styles.requiresLine}>
              On the <Text style={[styles.requiresTierEm, { color: tierColor }]}>{tierLabel}</Text> plan
            </Text>

            <Text style={styles.webExplain}>
              Subscriptions are managed in the MAGE ID mobile app. Once you upgrade
              there, {tierLabel} features are on everywhere, including here on the web.
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

            {practiceBlock}

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
        </SheetOverlay>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleDismiss}>
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? 16 : insets.top + 8 }]}>
          <View style={{ width: 36 }} />
          <Text style={styles.headerTitle}>Plans</Text>
          <TouchableOpacity onPress={handleDismiss} style={styles.closeBtn} testID="paywall-modal-close" accessibilityRole="button" accessibilityLabel="Close"><X size={22} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={[styles.heroIconWrap, { backgroundColor: tierColor + '15' }]}>
            <TierIcon size={36} color={tierColor} />
          </View>

          <Text style={styles.featureName}>{featureTitle}</Text>
          {pitch ? <Text style={styles.featurePitch}>{pitch}</Text> : null}
          <Text style={styles.requiresLine}>
            On the <Text style={[styles.requiresTierEm, { color: tierColor }]}>{tierLabel}</Text> plan
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
          <View style={[styles.toggleRow, isDesktop && segmentedDesktop.container]}>
            <TouchableOpacity
              style={[styles.toggleBtn, isDesktop && segmentedDesktop.segment, period === 'monthly' && styles.toggleBtnActive]}
              onPress={() => setPeriod('monthly')}
              activeOpacity={0.8}
              testID="paywall-period-monthly"
            >
              <Text style={[styles.toggleText, period === 'monthly' && styles.toggleTextActive]}>Monthly</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, isDesktop && segmentedDesktop.segment, period === 'annual' && styles.toggleBtnActive]}
              onPress={() => setPeriod('annual')}
              activeOpacity={0.8}
              testID="paywall-period-annual"
            >
              <Text style={[styles.toggleText, period === 'annual' && styles.toggleTextActive]}>Annual</Text>
              {/* Computed from the two store packages; hidden when either is
                  missing rather than printing a typed "Save 20%" (#42). */}
              {pricing.savePct !== null && (
                <View style={styles.saveBadge}>
                  <Text style={styles.saveBadgeText}>{`Save ${pricing.savePct}%`}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Price display */}
          <View style={styles.priceBox}>
            {period === 'monthly' ? (
              <>
                <Text style={styles.priceBig}>{pricing.monthlyPrice}</Text>
                <Text style={styles.priceSub}>
                  {pricing.monthlyIsList
                    ? 'list price, per month — the exact price is shown at checkout'
                    : 'per month, cancel anytime'}
                </Text>
              </>
            ) : pricing.monthlyEquivalent && pricing.annualPrice ? (
              <>
                <Text style={styles.priceBig}>{pricing.monthlyEquivalent}/mo</Text>
                <Text style={styles.priceSub}>billed {pricing.annualPrice} annually</Text>
                {/* Store numbers, integer cents, floored — never parsed back
                    out of display strings. */}
                {pricing.saveAmount ? (
                  <View style={styles.savingsRow}>
                    <Text style={styles.savingsRowText}>
                      Save <Text style={styles.savingsRowAmount}>{pricing.saveAmount}</Text> vs. monthly
                    </Text>
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.priceSub}>{PRICE_AT_CHECKOUT}</Text>
                <Text style={styles.priceSub}>billed annually</Text>
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

          {practiceBlock}

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
  // Wave 6d, the desktop web card: the scrim behind it (the app's overlay
  // token), and the card sized to its content up to the frame's 85% max
  // height — the ScrollView inside scrolls past that.
  webScrim: { backgroundColor: Colors.overlay },
  webCardDesktop: { flexGrow: 0, flexShrink: 1, flexBasis: 'auto', overflow: 'hidden' },
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
  // The practice offer is a secondary action: outlined, never the tier's fill
  // (the accent stays on Upgrade — it must not become a second primary).
  practiceWrap: { width: '100%', alignItems: 'center' as const, marginTop: 4, marginBottom: 2 },
  practiceBtn: {
    width: '100%',
    minHeight: Tokens.touchTarget.comfortable,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: t.line,
    backgroundColor: t.surface,
  },
  practiceBtnText: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '600' as const, flexShrink: 1, textAlign: 'center' as const },
  practiceSub: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center' as const, marginTop: 6, paddingHorizontal: 8 },
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
