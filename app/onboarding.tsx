// app/onboarding.tsx — first-run experience.
//
// Redesigned per the 2026 onboarding research: straight to aha.
// Flow: splash → preview cards → rates (seed costs) → estimate wizard.
// The paywall is AFTER the first-bid value, not before it.
//
// What this screen DOES NOT do, on purpose:
//   - No 7-slide carousel describing features. The product itself
//     describes its features once the user lands on home.
//   - No HardHat / Calculator / Blueprint icons. "Construction-themed
//     clipart" is the visual language of unserious software in 2026.
//   - No forced auth wall. The auth screen is a separate route; we
//     defer the prompt until after the user's seen value.
//   - No size-band routing question or import step on day one.
//     Import lives at app/import-pipeline.tsx; size-band config
//     lives in settings. Neither blocks the aha.
//
// What this screen DOES do:
//   - Splash with display-grade italic-mixed serif headline +
//     edge-to-edge brand-amber background.
//   - Preview card stack (5 cards, tap to advance).
//   - Seed-your-rates step: paste your costs → first estimate is
//     built on your numbers, not a national average.
//   - Hand-off to /estimate-wizard?onboarding=1 where the value
//     is live before anything asks the user to upgrade.

import React, { useCallback, useRef, useState, useEffect, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Animated,
  Easing,
  Platform,
  Pressable,
  Dimensions,
  KeyboardAvoidingView,
} from 'react-native';
import { continuousCorners, Motion, Tokens } from '@/constants/designTokens';
import { nativeDriver, useReducedMotion } from '@/components/ui/motion';
import GlideDots from '@/components/animations/GlideDots';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ArrowRight, Check, Ruler, Mic, TrendingUp } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { BrandBackdrop } from '@/components/BrandBackdrop';
import { useProjects } from '@/contexts/ProjectContext';
import { mergedBidBranding } from '@/utils/bidDocumentIdentity';
import { showAlert } from '@/utils/alert';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { parseSeedBlob, draftsToSeeds, type SeedParseResult } from '@/utils/costSeedCore';
import { useCostSeeds } from '@/hooks/useCostSeeds';
import { track, AnalyticsEvents } from '@/utils/analytics';
import { takePendingDeepLink } from '@/utils/pendingDeepLink';
import { ONBOARDING_TUTORIAL_ID, shouldAutoStartOnboardingTutorial } from '@/utils/tutorial/entryPoints';
import { isTutorialActive, startTutorial } from '@/utils/tutorial/store';

// Funnel screens are never a replay destination — a stash of one is left over
// from a bounce, and replaying it would loop him back into first-run.
const FUNNEL_ROUTES = new Set(['onboarding', 'persona-select', 'onboarding-paywall', 'login', 'signup', 'estimate-wizard']);

/**
 * #93: the stashed deep link, TAKEN (cleared) before completeOnboarding flips
 * the last gate flag. app/_layout.tsx replays a stash the moment that flag
 * flips, and every exit below also navigates — two navigations raced, and the
 * one that landed last won (an invitee could land in the estimate wizard
 * instead of the job he joined). Taking it first leaves the replay nothing;
 * the exit then goes to the stashed destination itself, or its own.
 */
async function takeReplayTarget(): Promise<string | null> {
  try {
    const pending = await takePendingDeepLink();
    if (!pending) return null;
    const route = pending.replace(/^\//, '').split('?')[0];
    return FUNNEL_ROUTES.has(route) ? null : pending;
  } catch {
    return null;
  }
}

// ── Brand palette local to onboarding — kept hardcoded so the splash
// looks identical regardless of any custom-primary the user has set
// later in Settings. The splash IS the brand.
const BRAND = {
  // Hero gradient is brand amber on ink (the green preset was off-brand — the
  // documented brand is amber/ink; see constants/colors.ts).
  green: '#FF6A1A',
  greenDeep: '#0B0D10',
  greenAccent: '#FF8533',
  orange: '#FF6A1A',
  orangeHot: '#FF8533',
  orangeDeep: '#C2410C',
  cream: '#F4EFE6',
  ink: '#0B0D10',
  fog: 'rgba(244,239,230,0.62)',
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Three-step flow: splash → preview cards → rates (terminal → estimate wizard).
type Step = 'splash' | 'preview' | 'rates';
const STEPS: Step[] = ['splash', 'preview', 'rates'];

// Motion (slick-3). The entrance is a 50 ms stagger of 220 ms fades (≤ 400 ms
// in all) with the lift on Motion.spring.rise; a step leaves 16 pt left over
// EXIT_MS and the next arrives from 16 pt right.
const STAGGER_MS = 50; // hoist into Motion.duration after round 3
const ENTER_MS = 220; // hoist into Motion.duration after round 3
const EXIT_MS = 140; // hoist into Motion.duration after round 3
const CARD_FADE_MS = 160; // hoist into Motion.duration after round 3
const STEP_SLIDE = 16;
const CARD_SLIDE = 12;

interface PreviewCard {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  title: string;
  body: string;
  /** Final card in the stack — renders the primary "try it" CTA. */
  isTryIt?: boolean;
}

// Preview cards — what you actually get. Anchors the value prop without
// requiring a real product GIF. Copy intentionally short (2026 norm: 6-12
// word headlines, ~15-25 word bodies).
const PREVIEW_CARDS: PreviewCard[] = [
  {
    Icon: MageAIMark,
    title: 'Win more jobs with Instant Bid',
    body: 'Tap once on a homeowner request — get a polished Good/Better/Best proposal with financing, ready to send in seconds.',
  },
  {
    Icon: Ruler,
    title: 'AI takeoffs from a PDF',
    body: 'Drop in plans. Get walls, doors, finishes in seconds. Then turn them into sub bid packages.',
  },
  {
    Icon: TrendingUp,
    title: 'Every job makes your next bid smarter',
    body: 'MAGE learns your real costs as you build. Each finished job sharpens the next estimate — a moat that compounds with every project.',
  },
  {
    Icon: Mic,
    title: 'Voice on the jobsite',
    body: 'Tap once, talk. AI logs your daily report, files the RFI, drafts the change order. Works offline.',
  },
  {
    Icon: Check,
    title: 'Your turn',
    // The sample path is now learn-by-doing, not a look-around: the first
    // tutorial (utils/tutorial/defs/dailyReportVoice) files today's report on
    // the sample by voice, so the copy promises exactly that and its time.
    body: "Price a real bid in about two minutes — or try it on a sample job first: you'll file a day's report by voice in about 35 seconds.",
    isTryIt: true,
  },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    completeOnboarding, settings, updateSettings, hasSeenOnboarding, userRole,
    addProject, addInvoice, addDailyReport, addPunchItem, addProjectPhoto, addRFI, addChangeOrder,
  } = useProjects();

  // #109: a user who has ALREADY finished first-run never belongs here. The
  // root gate only ever routes TO /onboarding, never off it, so any stray
  // navigation (Sign up with Apple/Google handing back an existing account
  // used to land here explicitly) sat a contractor with live jobs on the
  // first-run splash — whose sample-tour button can add a sample project to
  // his real account, and whose company-name step overwrites his branding.
  // Decided ONCE, on the first known value (null = still loading): the tour
  // and the first-bid path set hasSeenOnboarding=true mid-flow and navigate
  // themselves, and a guard that reacted to that flip would race them.
  const firstKnownOnboardingRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (hasSeenOnboarding === null || firstKnownOnboardingRef.current !== null) return;
    firstKnownOnboardingRef.current = hasSeenOnboarding;
    if (hasSeenOnboarding === true) router.replace('/(tabs)/(home)' as never);
  }, [hasSeenOnboarding, router]);
  const { addSeeds } = useCostSeeds();
  const { colors: themeColors } = useTheme();

  const [step, setStep] = useState<Step>('splash');

  // Company name, asked here rather than on top of the first send.
  // utils/bidDocumentIdentity blocks the first share until this is set — the
  // proposal header would otherwise print "MAGE ID", the software's name, on a
  // contractor's bid — so onboarding skipping it guaranteed that the ONE ask
  // that lands on a success (the bid leaving for the homeowner) was a form.
  // Optional: blank leaves the existing gate exactly as it was.
  const [companyName, setCompanyName] = useState('');

  // Card-stack progressive disclosure — which preview card is showing.
  const [cardIndex, setCardIndex] = useState(0);

  // ── Seed-your-rates step state. THE cold-start fix: utils/costDatabase only
  // learns from jobs closed inside MAGE, so without this a twenty-year
  // contractor's first estimate is priced identically to a beginner's. Pasting
  // the rates they already know makes the estimate wizard's grounding facts
  // non-empty on day one. Rates land tagged "you set this" and never count as
  // closed jobs — see utils/costSeedCore.
  //
  // Deliberately NOT tier-gated here: first-run happens before the paywall.
  // The Pro gate lives on the management screen, app/cost-seed.
  const [rateBlob, setRateBlob] = useState('');
  const [rateReview, setRateReview] = useState<SeedParseResult | null>(null);
  const [rateHint, setRateHint] = useState<string | null>(null);

  // Respect iOS Accessibility → Reduce Motion (and the web's
  // prefers-reduced-motion) through the app's one motion store. When on, we
  // cross-fade instead of slide + stagger.
  const reduceMotion = useReducedMotion();

  // ── Reveal animations — staggered fade + 8px rise, 50 ms apart, every step
  // in under 0.4 s. slideX carries the step-to-step slide.
  const eyebrowOpacity = useRef(new Animated.Value(0)).current;
  const headlineOpacity = useRef(new Animated.Value(0)).current;
  const bodyOpacity = useRef(new Animated.Value(0)).current;
  const ctaOpacity = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(8)).current;
  const slideX = useRef(new Animated.Value(0)).current;
  // Set while a step is sliding out; the steps' CTAs ignore taps meanwhile.
  const exitingRef = useRef(false);

  // CTA tap feedback.
  const ctaScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Reset on step change so each step gets its own reveal.
    eyebrowOpacity.setValue(0);
    headlineOpacity.setValue(0);
    bodyOpacity.setValue(0);
    ctaOpacity.setValue(0);
    lift.setValue(reduceMotion ? 0 : 8);

    if (reduceMotion) {
      // Reduce-motion path: simple cross-fade, no stagger, no lift. Same
      // landing state in ~200ms.
      slideX.setValue(0);
      Animated.parallel([
        Animated.timing(eyebrowOpacity, { toValue: 1, duration: 200, useNativeDriver: nativeDriver }),
        Animated.timing(headlineOpacity, { toValue: 1, duration: 200, useNativeDriver: nativeDriver }),
        Animated.timing(bodyOpacity, { toValue: 1, duration: 200, useNativeDriver: nativeDriver }),
        Animated.timing(ctaOpacity, { toValue: 1, duration: 200, useNativeDriver: nativeDriver }),
      ]).start();
      return;
    }

    const fadeIn = (v: Animated.Value) => Animated.timing(v, {
      toValue: 1, duration: ENTER_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
    });
    Animated.parallel([
      Animated.spring(lift, { toValue: 0, ...Motion.spring.rise, useNativeDriver: nativeDriver }),
      // The arriving step slides in from the right (a no-op on first mount,
      // where slideX is already 0).
      Animated.spring(slideX, { toValue: 0, ...Motion.spring.rise, useNativeDriver: nativeDriver }),
      Animated.stagger(STAGGER_MS, [
        fadeIn(eyebrowOpacity),
        fadeIn(headlineOpacity),
        fadeIn(bodyOpacity),
        fadeIn(ctaOpacity),
      ]),
    ]).start();
  }, [step, eyebrowOpacity, headlineOpacity, bodyOpacity, ctaOpacity, lift, slideX, reduceMotion]);

  // A step change: the old step fades and leaves 16 pt left, then the new one
  // mounts 16 pt right and the entrance above brings it home. Reduce Motion:
  // the step changes at once.
  const goStep = useCallback((next: Step) => {
    if (exitingRef.current) return;
    if (reduceMotion) { setStep(next); return; }
    exitingRef.current = true;
    const fadeOut = (v: Animated.Value) => Animated.timing(v, {
      toValue: 0, duration: EXIT_MS, easing: Easing.in(Easing.cubic), useNativeDriver: nativeDriver,
    });
    Animated.parallel([
      fadeOut(eyebrowOpacity),
      fadeOut(headlineOpacity),
      fadeOut(bodyOpacity),
      fadeOut(ctaOpacity),
      Animated.timing(slideX, {
        toValue: -STEP_SLIDE, duration: EXIT_MS, easing: Easing.in(Easing.cubic), useNativeDriver: nativeDriver,
      }),
    ]).start(() => {
      // Finished or interrupted, the step changes: an exit never strands him.
      exitingRef.current = false;
      slideX.setValue(STEP_SLIDE);
      setStep(next);
    });
  }, [reduceMotion, eyebrowOpacity, headlineOpacity, bodyOpacity, ctaOpacity, slideX]);

  // The preview card slides its content across on a cardIndex CHANGE after
  // mount: the arriving card rises in from 12 pt right. Armed during render
  // (a ref), so a first render carries no wrapper at all.
  const cardSlide = useRef(new Animated.Value(0)).current;
  const cardFade = useRef(new Animated.Value(1)).current;
  const prevCardIndexRef = useRef(cardIndex);
  const cardArmedRef = useRef(false);
  if (prevCardIndexRef.current !== cardIndex && !reduceMotion) cardArmedRef.current = true;
  useLayoutEffect(() => {
    if (prevCardIndexRef.current === cardIndex) return;
    prevCardIndexRef.current = cardIndex;
    if (!cardArmedRef.current || reduceMotion) return;
    cardSlide.setValue(CARD_SLIDE);
    cardFade.setValue(0);
    Animated.parallel([
      Animated.spring(cardSlide, { toValue: 0, ...Motion.spring.rise, useNativeDriver: nativeDriver }),
      Animated.timing(cardFade, {
        toValue: 1, duration: CARD_FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
      }),
    ]).start();
  }, [cardIndex, reduceMotion, cardSlide, cardFade]);
  const cardMotionStyle = cardArmedRef.current && !reduceMotion
    ? { opacity: cardFade, transform: [{ translateX: cardSlide }] }
    : null;

  // Activation funnel — mark the top of the rates step so we can compute
  // viewed→completed. Fires once when the step first renders.
  useEffect(() => {
    if (step === 'rates') track(AnalyticsEvents.ONBOARDING_RATES_VIEWED);
  }, [step]);

  // tutorial_offered {entry: 'onboarding'}: the last preview card carries
  // 'Try it on a sample job', which starts the DFR tutorial for a contractor
  // or 'both' persona. Once per mount — the offered → started denominator for
  // this door (spec §13). No replay target is known yet here; the offer is
  // the button, whatever handleTourSample then decides.
  const tourOfferedRef = useRef(false);
  const onTourCard = step === 'preview' && cardIndex >= PREVIEW_CARDS.length - 1;
  useEffect(() => {
    if (!onTourCard || tourOfferedRef.current) return;
    if (!shouldAutoStartOnboardingTutorial({ persona: userRole, replayTarget: null })) return;
    tourOfferedRef.current = true;
    track(AnalyticsEvents.TUTORIAL_OFFERED, { tutorial_id: ONBOARDING_TUTORIAL_ID, entry: 'onboarding' });
  }, [onTourCard, userRole]);

  const handleStarted = useCallback(() => {
    if (exitingRef.current) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!reduceMotion) {
      Animated.sequence([
        Animated.spring(ctaScale, { toValue: 0.97, ...Motion.spring.snap, useNativeDriver: nativeDriver }),
        Animated.spring(ctaScale, { toValue: 1, ...Motion.spring.snap, useNativeDriver: nativeDriver }),
      ]).start();
    }
    goStep('preview');
  }, [ctaScale, goStep, reduceMotion]);

  const handlePreviewNext = useCallback(() => {
    if (exitingRef.current) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    goStep('rates');
  }, [goStep]);

  // ── Try it on a sample job ───────────────────────────────────────────
  // utils/demoSeed builds a finished job — invoices, daily reports, punch
  // items, RFIs, a change order, photos — and it is the fastest "oh, I get
  // it" the product has. Until now the only door to it was a small link
  // under the Home empty state, which a user reaches by ABANDONING this
  // flow: the one asset that explains MAGE in thirty seconds was hidden
  // behind giving up on onboarding. So it sits here, beside the real-bid
  // CTA, as a peer choice.
  //
  // Seeds the 'small' flavor rather than opening DemoSeedPickerModal: a
  // two-card choice is friction at the exact moment the user has not yet
  // seen anything to choose between, and a $422K kitchen-and-two-baths
  // remodel is the job most new accounts recognise. The full picker still
  // lives on Home for anyone who wants the $14M condo instead.
  const seedingRef = useRef(false);
  const [seedingSample, setSeedingSample] = useState(false);

  const handleTourSample = useCallback(async () => {
    // The ref is the guard, not the state flag: setSeedingSample does not
    // take effect until the next render, so two taps inside one frame would
    // both read `false` and seed the account two sample projects deep.
    if (seedingRef.current) return;
    seedingRef.current = true;
    setSeedingSample(true);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    let projectId: string;
    try {
      // Lazily required, the same way app/(tabs)/(home)/index.tsx does it —
      // the seed is several hundred lines of fixture data and first-run
      // should not pay for it unless the user asks.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { seedDemoProject } = require('@/utils/demoSeed');
      ({ projectId } = await seedDemoProject({
        addProject, addInvoice, addDailyReport, addPunchItem,
        addProjectPhoto, addRFI, addChangeOrder,
        flavor: 'small',
      }));
    } catch (err) {
      // The latch is released HERE and nowhere else. It used to wrap the whole
      // body: completeOnboarding or the navigation throwing after a successful
      // seed re-armed the button with a sample project already written, and the
      // next tap wrote a second one.
      //
      // Releasing here is a judgement, not a guarantee of a clean slate.
      // seedDemoProject writes through the plain context setters and does not
      // await between them, so a throw part-way leaves whatever it had already
      // written — most likely the project row with none of its invoices. Another
      // tap is still the right offer: the alternative is a dead button at the
      // one moment a new account is deciding whether this product works, and a
      // stray sample is deletable from its own project tile (the seed's
      // description says so). A failure AFTER the seed is different — there the
      // sample is complete and visible, so re-arming would only duplicate it.
      seedingRef.current = false;
      setSeedingSample(false);
      console.warn('[onboarding] sample seed failed', err);
      showAlert('Could not build the sample', 'Something went wrong loading the sample job. Try again, or start with a real bid.');
      return;
    }

    // Past this line the sample EXISTS on the account, so the latch stays shut
    // whatever happens next. `seedingSample` stays true with it, which means a
    // navigation that somehow threw would leave both CTAs disabled — survivable
    // only because completeOnboarding runs first, below: with the flag set, the
    // root gate in app/_layout.tsx no longer sends this user to /onboarding, so
    // a relaunch lands them on the home tab with the sample sitting there.
    // Mark onboarding done so the user is never looped back through the splash.
    const replayTarget = await takeReplayTarget();
    try {
      await completeOnboarding();
    } catch (err) {
      // Only AsyncStorage can fail here, and the sample is already built —
      // stranding the user on the splash to protect a flag would be worse.
      console.warn('[onboarding] completeOnboarding failed after sample seed', err);
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // REPLACE onto the tab shell first, then PUSH the sample job on top of it.
    // A bare `replace` onto /project-detail was a dead end: app/_layout.tsx
    // deliberately declares no `initialRouteName` anchor (see UX-F18 there), so
    // replacing the only entry in the root stack leaves a stack of one —
    // project-detail is not inside (tabs), so there is no tab bar, and the
    // native header draws no back chevron at stack index 0. The user who
    // chose the sample tour could see the sample and nothing else, ever.
    // Replacing with the tab shell and pushing on top gives Back something to
    // pop to and puts the tab bar underneath.
    router.replace('/(tabs)/(home)' as never);
    // Learn by doing (spec entry point 1): the ONE place a tutorial starts by
    // itself, and only because he just chose 'Try it on a sample job'. The
    // host (components/tutorial/TutorialHost) waits for the tab shell to
    // settle outside the funnel routes, then pushes the sample hub and the
    // daily report on top of it — the same two-deep stack as below, so Back
    // still has somewhere to go. A waiting deep link always wins (he came for
    // that screen), and a client / property-manager persona never gets a tour.
    if (shouldAutoStartOnboardingTutorial({ persona: userRole, replayTarget })) {
      const started = await startTutorial(ONBOARDING_TUTORIAL_ID, { sandboxProjectId: projectId, entry: 'onboarding' });
      // No host mounted, or the boot failed before it navigated: fall through
      // to the plain sample job so the button never lands him nowhere.
      if (started || isTutorialActive()) return;
    }
    router.push((replayTarget ?? { pathname: '/project-detail', params: { id: projectId } }) as never);
  }, [addProject, addInvoice, addDailyReport, addPunchItem, addProjectPhoto, addRFI, addChangeOrder, completeOnboarding, router, userRole]);

  // NO SIGN-IN LINK ON THIS SCREEN, deliberately. app/_layout.tsx:563 only
  // routes here when `isAuthenticated` is already true — onboarding is a
  // POST-auth flow — so "Already have an account? Sign in" was offered to
  // someone who is signed in. Tapping it pushed /login, which has no sign-out
  // path (grep signOut in app/login.tsx returns 0), so the root gate bounced
  // him straight back with `step` reset to splash: a dead control that also
  // threw away his place in the flow.

  // Terminal hand-off — lands the user inside the estimate wizard so they
  // price a real bid before anything asks them to upgrade. Called by both
  // the "Price your first bid →" CTA and the "I'll add rates later" skip.
  // completeOnboarding() sets hasSeenOnboarding so the user is never
  // re-looped back here. No demo-seed: the wizard itself is the aha.
  const goPriceFirstBid = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Saved on both exits from this step (paste rates or skip them), so the
    // name is captured whichever way he leaves.
    const typedName = companyName.trim();
    if (typedName) {
      updateSettings({ branding: mergedBidBranding(settings?.branding, { companyName: typedName }) });
    }
    const replayTarget = await takeReplayTarget();
    await completeOnboarding();
    if (replayTarget) {
      // He came here for a specific screen (an invite's project, a shared
      // link); open it over the tab shell instead of the first-bid wizard.
      router.replace('/(tabs)/(home)' as never);
      router.push(replayTarget as never);
      return;
    }
    router.replace('/estimate-wizard?onboarding=1' as never);
  }, [completeOnboarding, router, companyName, settings?.branding, updateSettings]);

  // ── Seed-your-rates step ─────────────────────────────────────────────
  const handleRatesParse = useCallback(() => {
    const parsed = parseSeedBlob(rateBlob);
    if (parsed.rows.length === 0) {
      setRateHint(
        parsed.rejected.length > 0
          ? "Couldn't read a rate from those lines. Each needs a trade, a unit (SF, LF, EA, HR…) and a price."
          : 'Paste one rate per line — trade, unit, price. For example: Framing, SF, $12.50',
      );
      return;
    }
    setRateHint(null);
    setRateReview(parsed);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [rateBlob]);

  const handleRatesCommit = useCallback(() => {
    if (!rateReview || rateReview.rows.length === 0) return;
    const seeds = draftsToSeeds(rateReview.rows, { now: new Date().toISOString(), method: 'paste' });
    addSeeds(seeds);
    track(AnalyticsEvents.ONBOARDING_RATES_COMPLETED, { count: seeds.length });
    // goPriceFirstBid fires its own success haptic — skip the redundant one here.
    void goPriceFirstBid();
  }, [rateReview, addSeeds, goPriceFirstBid]);

  const handleRatesSkip = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    track(AnalyticsEvents.ONBOARDING_RATES_SKIPPED);
    void goPriceFirstBid();
  }, [goPriceFirstBid]);

  // Top-bar Skip — bails out of the whole flow without seeding rates.
  //
  // Lands in the APP, not on the paywall. This used to be
  // router.replace('/onboarding-paywall'), which asked a brand-new contractor
  // for $29 having shown him nothing at all — the exact thing this file's own
  // header forbids ("The paywall is AFTER the first-bid value, not before
  // it") and the exact thing estimate-wizard.tsx:1893 already fixed for the
  // wizard's Cancel, under a comment saying so. A hard-skipper still should
  // not be forced into the wizard arc; he goes home. The paywall still owns
  // every path that follows a real result.
  const handleSkip = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const replayTarget = await takeReplayTarget();
    await completeOnboarding();
    router.replace('/(tabs)/(home)' as never);
    if (replayTarget) router.push(replayTarget as never);
  }, [router, completeOnboarding]);

  return (
    <View style={[styles.root, { backgroundColor: themeColors.bg }]}>
      {/* Background — ink field with corner accent glows.
          The large field is ink; accent orange lives only in the
          corner-glow layers (doctrine: accent is never the background). */}
      <BrandBackdrop />

      {/* Subtle grain texture — a single transparent layer with a
          repeating-radial-gradient on web; on native, expressed as a
          stacked low-opacity "noise" via a few absolutely-positioned
          dots. Skipped here to keep the file lean; the layered gradients
          above already give a polished, non-flat finish. */}

      {/* Top bar — wordmark left, Skip right. Skip is always visible
          per 2026 best practice; placing it in the same color family as
          everything else (off-white at 62%) keeps it discoverable
          without competing with the CTA. */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.wordmark}>MAGE&nbsp;ID</Text>
        <TouchableOpacity onPress={handleSkip} hitSlop={10} style={styles.skipBtn} testID="onboarding-skip">
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* Step indicator — three dots for splash → preview → rates.
          The active dot grows wider; non-active stay small. */}
      <GlideDots
        count={STEPS.length}
        active={STEPS.indexOf(step)}
        dotW={styles.stepDot.width as number}
        activeW={styles.stepDotActive.width as number}
        height={styles.stepDot.height as number}
        gap={styles.stepDots.gap as number}
        color={styles.stepDot.backgroundColor as string}
        activeColor={styles.stepDotActive.backgroundColor as string}
        style={styles.stepDots}
        dotStyle={styles.stepDot}
        activeStyle={styles.stepDotActive}
      />

      {/* Body — switches between splash and routing. Both use the same
          reveal animations so the transition feels coherent. */}
      {step === 'splash' && (
        <Animated.View
          style={[
            styles.body,
            { paddingBottom: insets.bottom + 24, transform: [{ translateY: lift }, { translateX: slideX }] },
          ]}
        >
          <View style={{ flex: 1 }} />

          <Animated.Text style={[styles.eyebrow, { opacity: eyebrowOpacity }]}>
            <Text style={styles.eyebrowDot}>●</Text>  the operating system for builders
          </Animated.Text>

          {/* Display headline. Italic for the middle phrase to introduce
              expressive serif feel using system fonts (Georgia on iOS,
              the platform serif fallback elsewhere). No new font
              dependency required. */}
          <Animated.Text style={[styles.headline, { opacity: headlineOpacity }]}>
            <Text style={styles.headlineRoman}>Build it.{' '}</Text>
            <Text style={styles.headlineItalic}>Bill it.{' '}</Text>
            <Text style={styles.headlineRoman}>Track every dollar.</Text>
          </Animated.Text>

          <Animated.Text style={[styles.lede, { opacity: bodyOpacity }]}>
            Plans, estimates, AI takeoffs, daily reports, change orders, AIA pay apps,
            a live client portal — replaced a dozen tools with one app you carry on the jobsite.
          </Animated.Text>

          {/* Trust line — sets pricing expectations upfront so users
              tapping "Get started" know the deal. Sized small (caption,
              cream@78%, uppercase tracking) so it doesn't compete with
              the display headline. */}
          <Animated.Text style={[styles.trustLine, { opacity: bodyOpacity }]}>
            Free to try  ·  $29/mo  ·  Cancel anytime
          </Animated.Text>

          <Animated.View style={{ opacity: ctaOpacity, transform: [{ scale: ctaScale }] }}>
            <Pressable
              onPress={handleStarted}
              style={({ pressed }) => [
                styles.ctaPrimary,
                pressed && { opacity: 0.92 },
              ]}
              accessibilityLabel="Get started with MAGE ID"
              accessibilityRole="button"
              testID="onboarding-cta"
            >
              <Text style={styles.ctaPrimaryText}>Get started</Text>
              <ArrowRight size={18} color={BRAND.ink} strokeWidth={2.4} />
            </Pressable>
          </Animated.View>

        </Animated.View>
      )}

      {step === 'preview' && (
        <Animated.View
          style={[
            styles.body,
            { paddingBottom: insets.bottom + 24, transform: [{ translateY: lift }, { translateX: slideX }] },
          ]}
        >
          <View style={{ flex: 1 }} />

          <Animated.Text style={[styles.eyebrow, { opacity: eyebrowOpacity }]}>
            <Text style={styles.eyebrowDot}>●</Text>  what you&apos;re getting
          </Animated.Text>

          <Animated.Text style={[styles.headline, { opacity: headlineOpacity }]}>
            <Text style={styles.headlineRoman}>One app.{' '}</Text>
            <Text style={styles.headlineItalic}>The whole job.</Text>
          </Animated.Text>

          {/* Card-stack progressive disclosure — one beat at a time. Tap the
              card (or the CTA) to reveal the next; the final "try it" card
              advances the flow. Progress pips show position. */}
          <Animated.View style={[styles.previewList, { opacity: bodyOpacity }]}>
            {(() => {
              const card = PREVIEW_CARDS[Math.min(cardIndex, PREVIEW_CARDS.length - 1)];
              const Icon = card.Icon;
              const isLast = cardIndex >= PREVIEW_CARDS.length - 1;
              const advance = () => {
                if (exitingRef.current) return;
                if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (isLast) { handlePreviewNext(); return; }
                setCardIndex(i => i + 1);
              };
              const cardEl = (
                <Pressable
                  onPress={advance}
                  style={({ pressed }) => [styles.previewCard, pressed && { opacity: 0.92 }]}
                  accessibilityRole="button"
                  accessibilityLabel={card.title}
                  testID={`onboarding-preview-card-${cardIndex}`}
                >
                  <View style={styles.previewIcon}>
                    <Icon size={18} color={BRAND.orange} strokeWidth={2.2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.previewTitle}>{card.title}</Text>
                    <Text style={styles.previewBody}>{card.body}</Text>
                  </View>
                </Pressable>
              );
              return (
                <>
                  {cardMotionStyle ? <Animated.View style={cardMotionStyle}>{cardEl}</Animated.View> : cardEl}

                  <GlideDots
                    count={PREVIEW_CARDS.length}
                    active={cardIndex}
                    dotW={styles.pip.width as number}
                    activeW={styles.pipActive.width as number}
                    height={styles.pip.height as number}
                    gap={styles.pipRow.gap as number}
                    color={styles.pip.backgroundColor as string}
                    activeColor={styles.pipActive.backgroundColor as string}
                    style={styles.pipRow}
                    dotStyle={styles.pip}
                    activeStyle={styles.pipActive}
                  />

                  <Animated.View style={{ opacity: ctaOpacity, marginTop: 8, transform: [{ scale: ctaScale }] }}>
                    <Pressable
                      onPress={advance}
                      disabled={seedingSample}
                      style={({ pressed }) => [styles.ctaPrimary, styles.ctaWide, pressed && { opacity: 0.92 }]}
                      accessibilityRole="button"
                      accessibilityLabel={isLast ? 'Price a real bid' : 'Next'}
                      testID="onboarding-preview-next"
                    >
                      <Text style={styles.ctaPrimaryText}>{isLast ? 'Price a real bid' : 'Next'}</Text>
                      <ArrowRight size={18} color={BRAND.ink} strokeWidth={2.4} />
                    </Pressable>

                    {/* The sample job, offered as a peer of the real bid — not
                        as the consolation prize you find by quitting. */}
                    {isLast && (
                      <Pressable
                        onPress={handleTourSample}
                        disabled={seedingSample}
                        style={({ pressed }) => [
                          styles.ctaSecondary,
                          seedingSample && { opacity: 0.6 },
                          pressed && { opacity: 0.82 },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Try it on a sample job"
                        accessibilityState={{ busy: seedingSample, disabled: seedingSample }}
                        testID="onboarding-tour-sample"
                      >
                        <Text style={styles.ctaSecondaryText}>
                          {seedingSample ? 'Building the sample job…' : 'Try it on a sample job'}
                        </Text>
                      </Pressable>
                    )}
                  </Animated.View>
                </>
              );
            })()}
          </Animated.View>

        </Animated.View>
      )}

      {/* Seed-your-rates — the cost-book cold-start fix. MAGE's whole pitch is
          "it learns your real costs", but utils/costDatabase only learns from
          jobs closed inside the app: a twenty-year contractor's day-one
          estimate was a beginner's, and stayed that way for 6-18 months.
          Pasting the rates they already know makes the very first estimate
          theirs. Parsed by the shared utils/costSeedCore; rates are stored
          tagged "you set this" and never counted as closed jobs. Terminal step
          — exits into the estimate wizard, not home. */}
      {step === 'rates' && (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 72}
        >
          <Animated.View
            style={[
              styles.body,
              { paddingBottom: insets.bottom + 24, transform: [{ translateY: lift }, { translateX: slideX }] },
            ]}
          >
            <View style={{ flex: 1 }} />

            <Animated.Text style={[styles.eyebrow, { opacity: eyebrowOpacity }]}>
              <Text style={styles.eyebrowDot}>●</Text>  price from your numbers
            </Animated.Text>

            <Animated.Text style={[styles.headline, { opacity: headlineOpacity }]}>
              <Text style={styles.headlineRoman}>You already{' '}</Text>
              <Text style={styles.headlineItalic}>know{' '}</Text>
              <Text style={styles.headlineRoman}>your costs.</Text>
            </Animated.Text>

            {!rateReview ? (
              <Animated.View style={{ opacity: bodyOpacity }}>
                <Text style={styles.lede}>
                  MAGE learns your rates from every job you close — which means nothing to
                  price with today. Paste what you already charge and your first estimate is
                  built on your numbers, not a national average.
                </Text>
                <Text style={styles.fieldLabel}>Your company name</Text>
                <TextInput
                  style={styles.nameInput}
                  value={companyName}
                  onChangeText={setCompanyName}
                  placeholder="e.g. Harlow Building Co."
                  placeholderTextColor={BRAND.fog}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="next"
                  testID="onboarding-company-name"
                />
                <Text style={styles.fieldNote}>
                  Prints on the header of every bid you send. Optional — we&apos;ll ask before the
                  first one goes out if you skip it.
                </Text>
                <TextInput
                  style={styles.pasteInput}
                  value={rateBlob}
                  onChangeText={(v) => { setRateBlob(v); setRateHint(null); }}
                  placeholder={'Framing, SF, $12.50\nDrywall hang & finish, SF, 3.20\nElectrical rough-in, EA, $145'}
                  placeholderTextColor={BRAND.fog}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                  textAlignVertical="top"
                  testID="onboarding-rates-blob"
                />
                {!!rateHint && <Text style={styles.rateHint}>{rateHint}</Text>}
                <Pressable
                  onPress={handleRatesParse}
                  disabled={!rateBlob.trim()}
                  style={({ pressed }) => [
                    styles.ctaPrimary,
                    styles.ctaWide,
                    !rateBlob.trim() && { opacity: 0.5 },
                    pressed && { opacity: 0.92 },
                  ]}
                  accessibilityLabel="Review the rates before adding them"
                  accessibilityRole="button"
                  testID="onboarding-rates-review"
                >
                  <Text style={styles.ctaPrimaryText}>Review rates</Text>
                  <ArrowRight size={18} color={BRAND.ink} strokeWidth={2.4} />
                </Pressable>
                <TouchableOpacity
                  onPress={handleRatesSkip}
                  hitSlop={8}
                  style={styles.rateSkip}
                  testID="onboarding-rates-skip"
                >
                  <Text style={styles.signInText}>
                    <Text style={styles.signInLink}>I&apos;ll add rates later</Text>
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            ) : (
              <Animated.View style={{ opacity: bodyOpacity }}>
                <View style={styles.confirmCard}>
                  <View style={styles.confirmHeadRow}>
                    <TrendingUp size={16} color={BRAND.orange} strokeWidth={2.2} />
                    <Text style={styles.confirmCount}>
                      {rateReview.rows.length} rate{rateReview.rows.length === 1 ? '' : 's'} ready
                    </Text>
                  </View>
                  <View style={styles.nameChipRow}>
                    {rateReview.rows.slice(0, 6).map((r, i) => (
                      <View key={`${r.trade}-${r.unit}-${i}`} style={styles.nameChip}>
                        <Text style={styles.nameChipText} numberOfLines={1}>
                          {r.trade} ${r.rate.toFixed(2)}/{r.unit}
                        </Text>
                      </View>
                    ))}
                    {rateReview.rows.length > 6 && (
                      <View style={styles.nameChip}>
                        <Text style={styles.nameChipText}>+{rateReview.rows.length - 6} more</Text>
                      </View>
                    )}
                  </View>
                  {rateReview.rejected.length > 0 && (
                    <Text style={styles.rateHint}>
                      {rateReview.rejected.length} line{rateReview.rejected.length === 1 ? '' : 's'} skipped —
                      {' '}{rateReview.rejected[0].reason}
                    </Text>
                  )}
                  <Text style={styles.seedNote}>
                    Saved as rates you set — never counted as closed jobs. Every job you finish
                    corrects them.
                  </Text>
                </View>
                <Pressable
                  onPress={handleRatesCommit}
                  style={({ pressed }) => [
                    styles.ctaPrimary,
                    styles.ctaWide,
                    pressed && { opacity: 0.92 },
                  ]}
                  accessibilityLabel={`Save ${rateReview.rows.length} rate${rateReview.rows.length === 1 ? '' : 's'} and price your first bid`}
                  accessibilityRole="button"
                  testID="onboarding-rates-commit"
                >
                  <Text style={styles.ctaPrimaryText}>Price your first bid →</Text>
                </Pressable>
                <TouchableOpacity
                  onPress={() => setRateReview(null)}
                  hitSlop={8}
                  style={styles.rateSkip}
                >
                  <Text style={styles.signInText}>
                    <Text style={styles.signInLink}>Back to edit</Text>
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BRAND.greenDeep,
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  wordmark: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800',
    letterSpacing: 2,
    color: BRAND.cream,
  },
  skipBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Tokens.radius.full,
    backgroundColor: 'rgba(244,239,230,0.10)',
  },
  skipText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700',
    color: BRAND.cream,
    letterSpacing: 0.4,
  },

  stepDots: {
    flexDirection: 'row',
    alignSelf: 'center',
    gap: 6,
    marginTop: 6,
  },
  stepDot: {
    width: 18,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(244,239,230,0.22)',
  },
  stepDotActive: {
    backgroundColor: BRAND.cream,
    width: 28,
  },

  body: {
    flex: 1,
    paddingHorizontal: 24,
  },

  eyebrow: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: BRAND.fog,
    marginBottom: 18,
  },
  eyebrowDot: {
    color: BRAND.orange,
  },

  headline: {
    color: BRAND.cream,
    fontSize: Math.min(56, SCREEN_WIDTH * 0.13),
    lineHeight: Math.min(60, SCREEN_WIDTH * 0.14),
    letterSpacing: -1.2,
    marginBottom: 22,
  },
  headlineRoman: {
    // Fraunces 700 Bold — loaded in _layout.tsx via @expo-google-fonts.
    // Falls back to Georgia / serif when the font network-blips on first
    // launch (we never block the user on it).
    fontFamily: 'Fraunces_700Bold',
    fontWeight: '700',
  },
  headlineItalic: {
    fontFamily: 'Fraunces_700Bold_Italic',
    fontWeight: '700',
    fontStyle: 'italic',
    color: BRAND.orange,
  },

  lede: {
    fontSize: Type.subhead.fontSize,
    lineHeight: 22,
    color: BRAND.fog,
    marginBottom: 20,
    maxWidth: 520,
  },

  // Trust line — small mono-ish row between lede and CTA. Sets pricing
  // expectations upfront. Cream@78% so it reads without competing with
  // the headline.
  trustLine: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: 'rgba(244,239,230,0.78)',
    letterSpacing: 0.4,
    marginBottom: 24,
    textTransform: 'uppercase' as const,
  },

  ctaPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: BRAND.cream,
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderRadius: Tokens.radius.lg,
    ...continuousCorners, // iOS squircle — premium polish marker
    alignSelf: 'flex-start',
    shadowColor: BRAND.orange,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 6,
    // Min 48pt touch target per Apple HIG premium bar
    minHeight: 48,
  },
  ctaPrimaryText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '800',
    letterSpacing: 0.2,
    color: BRAND.ink,
  },
  // Full-width variant for the import step's CTAs (the paste box is
  // full-bleed, so a flex-start button would look orphaned beside it).
  ctaWide: {
    alignSelf: 'stretch',
    marginTop: 4,
  },

  // Secondary CTA under the primary — outlined cream on ink so it reads as a
  // real choice rather than a footnote, without competing with the filled
  // primary. Used for "Try it on a sample job" on the final preview card.
  ctaSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 22,
    paddingVertical: 15,
    borderRadius: Tokens.radius.lg,
    ...continuousCorners,
    borderWidth: 1,
    borderColor: 'rgba(244,239,230,0.34)',
    backgroundColor: 'rgba(244,239,230,0.06)',
    minHeight: 48,
  },
  ctaSecondaryText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700',
    letterSpacing: 0.2,
    color: BRAND.cream,
  },

  signInText: {
    fontSize: Type.footnote.fontSize,
    color: BRAND.fog,
    fontWeight: '600',
  },
  signInLink: {
    color: BRAND.cream,
    textDecorationLine: 'underline',
  },

  // ── Preview cards ───────────────────────────────────────────────
  previewList: {
    gap: 10,
    marginTop: 4,
  },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: Tokens.radius.lg,
    ...continuousCorners,
    backgroundColor: 'rgba(244,239,230,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(244,239,230,0.12)',
  },
  previewIcon: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.md,
    backgroundColor: 'rgba(255,106,26,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,106,26,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewTitle: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700',
    color: BRAND.cream,
    letterSpacing: -0.1,
  },
  previewBody: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '500',
    color: BRAND.fog,
    marginTop: 4,
    lineHeight: 18,
  },
  pipRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: 14,
  },
  pip: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(244,239,230,0.22)',
  },
  pipActive: {
    backgroundColor: BRAND.cream,
    width: 18,
  },

  // ── Rates step paste / confirm UI ───────────────────────────────────
  fieldLabel: {
    fontSize: Type.caption1.fontSize,
    color: BRAND.cream,
    fontWeight: '700' as const,
    marginBottom: 6,
  },
  nameInput: {
    backgroundColor: 'rgba(244,239,230,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(244,239,230,0.16)',
    borderRadius: Tokens.radius.lg,
    ...continuousCorners,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: Type.bodyCompact.fontSize,
    color: BRAND.cream,
    marginBottom: 6,
  },
  fieldNote: {
    fontSize: Type.caption2.fontSize,
    color: BRAND.fog,
    lineHeight: 15,
    marginBottom: 12,
  },
  pasteInput: {
    minHeight: 140,
    backgroundColor: 'rgba(244,239,230,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(244,239,230,0.16)',
    borderRadius: Tokens.radius.lg,
    ...continuousCorners,
    padding: 14,
    fontSize: Type.bodyCompact.fontSize,
    color: BRAND.cream,
    lineHeight: 22,
    marginBottom: 12,
  },
  rateHint: {
    fontSize: Type.footnote.fontSize,
    color: BRAND.orangeHot,
    lineHeight: 18,
    marginBottom: 12,
  },
  rateSkip: {
    marginTop: 14,
    alignSelf: 'center',
  },
  confirmCard: {
    backgroundColor: 'rgba(244,239,230,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(244,239,230,0.12)',
    borderRadius: Tokens.radius.lg,
    ...continuousCorners,
    padding: 16,
    marginBottom: 16,
  },
  confirmHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  confirmCount: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '800',
    color: BRAND.cream,
    letterSpacing: -0.2,
  },
  nameChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  nameChip: {
    backgroundColor: 'rgba(244,239,230,0.10)',
    borderRadius: Tokens.radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: 170,
  },
  nameChipText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600',
    color: BRAND.cream,
  },

  // Seed-your-rates step — the honesty line under the review chips.
  seedNote: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '500',
    color: BRAND.fog,
    lineHeight: 16,
    marginTop: 12,
  },
});
