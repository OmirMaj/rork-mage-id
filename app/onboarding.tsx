// app/onboarding.tsx — first-run experience.
//
// Redesigned per the 2026 onboarding research: carousel killed, kept
// to two screens (splash → routing question → home). Brand color is
// the background (Cash App move). Display headline with italic emphasis
// is the focal point. One primary CTA per screen. Skip always visible.
//
// What this screen DOES NOT do, on purpose:
//   - No 7-slide carousel describing features. The product itself
//     describes its features once the user lands on home.
//   - No HardHat / Calculator / Blueprint icons. "Construction-themed
//     clipart" is the visual language of unserious software in 2026.
//   - No forced auth wall. The auth screen is a separate route; we
//     defer the prompt until after the user's seen value.
//
// What this screen DOES do:
//   - Splash with display-grade italic-mixed serif headline +
//     edge-to-edge brand-green background.
//   - One routing question — "how big is the job you're running?" —
//     captured to AsyncStorage so home + estimator + AI prompts can
//     personalize.
//   - Drops the user on home where the existing OnboardingChecklist
//     and DemoSeedPickerModal handle the rest.

import React, { useCallback, useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Platform,
  Pressable,
  Dimensions,
  AccessibilityInfo,
} from 'react-native';
import { continuousCorners, Tokens } from '@/constants/designTokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { ArrowRight, Check, Ruler, DollarSign, Mic } from 'lucide-react-native';
import { useProjects } from '@/contexts/ProjectContext';
import { Type } from '@/constants/typography';
import {
  saveOnboardingProfile,
  SIZE_BAND_LABELS,
  SIZE_BAND_PERSONA,
  suggestedDemoFlavorForBand,
  type ProjectSizeBand,
} from '@/utils/onboardingProfile';

// ── Brand palette local to onboarding — kept hardcoded so the splash
// looks identical regardless of any custom-primary the user has set
// later in Settings. The splash IS the brand.
const BRAND = {
  green: '#1A6B3C',
  greenDeep: '#0F4526',
  greenAccent: '#2A9055',
  orange: '#FF6A1A',
  orangeHot: '#FF8533',
  cream: '#F4EFE6',
  ink: '#0B0D10',
  fog: 'rgba(244,239,230,0.62)',
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Step = 'splash' | 'preview' | 'routing';

interface PreviewCard {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  title: string;
  body: string;
}

// Preview cards — what you actually get. Anchors the value prop without
// requiring a real product GIF. Copy intentionally short (2026 norm: 6-12
// word headlines, ~15-25 word bodies).
const PREVIEW_CARDS: PreviewCard[] = [
  {
    Icon: Ruler,
    title: 'AI takeoffs from a PDF',
    body: 'Drop in plans. Get walls, doors, finishes in seconds. Then turn them into sub bid packages.',
  },
  {
    Icon: DollarSign,
    title: 'Money on the schedule',
    body: 'Cost-loaded Gantt with Planned vs Earned Value, AIA G702/G703 pay apps, 12-week cash flow.',
  },
  {
    Icon: Mic,
    title: 'Voice on the jobsite',
    body: 'Tap once, talk. AI logs your daily report, files the RFI, drafts the change order. Works offline.',
  },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const projectCtx = useProjects();
  const { completeOnboarding } = projectCtx;

  const [step, setStep] = useState<Step>('splash');

  // Respect iOS Accessibility → Reduce Motion. When on, we cross-fade
  // instead of slide-up + stagger. Apple HIG mandates this; premium apps
  // ship it from day one.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => {
      if (mounted) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);

  // ── Reveal animations — staggered fade + 8px rise. ~120ms apart so
  // the splash feels composed rather than dumped.
  const eyebrowOpacity = useRef(new Animated.Value(0)).current;
  const headlineOpacity = useRef(new Animated.Value(0)).current;
  const bodyOpacity = useRef(new Animated.Value(0)).current;
  const ctaOpacity = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(8)).current;

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
      Animated.parallel([
        Animated.timing(eyebrowOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(headlineOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(bodyOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(ctaOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      return;
    }

    Animated.parallel([
      Animated.timing(lift, {
        toValue: 0, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.stagger(120, [
        Animated.timing(eyebrowOpacity, { toValue: 1, duration: 360, useNativeDriver: true }),
        Animated.timing(headlineOpacity, { toValue: 1, duration: 420, useNativeDriver: true }),
        Animated.timing(bodyOpacity, { toValue: 1, duration: 360, useNativeDriver: true }),
        Animated.timing(ctaOpacity, { toValue: 1, duration: 360, useNativeDriver: true }),
      ]),
    ]).start();
  }, [step, eyebrowOpacity, headlineOpacity, bodyOpacity, ctaOpacity, lift, reduceMotion]);

  const handleStarted = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.sequence([
      Animated.timing(ctaScale, { toValue: 0.94, duration: 80, useNativeDriver: true }),
      Animated.timing(ctaScale, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    setStep('preview');
  }, [ctaScale]);

  const handlePreviewNext = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep('routing');
  }, []);

  const handleSignIn = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    router.push('/login' as never);
  }, [router]);

  const finishToHome = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await completeOnboarding();
    // Route into the Roamy-style trial activation funnel:
    //   /trial-feature → /trial-offer → /trial-reminder → /trial-design
    // The /trial-design screen is the one with the redeem button; on
    // successful purchase or skip, control returns to /(tabs)/(home).
    // Existing free-tier users who close the app and reopen don't
    // re-enter this funnel — the auth gate only routes here once,
    // gated by hasSeenOnboarding.
    router.replace('/trial-feature' as never);
  }, [completeOnboarding, router]);

  const handleBandPick = useCallback(async (band: ProjectSizeBand) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await saveOnboardingProfile({
      completedAt: new Date().toISOString(),
      sizeBand: band,
    });
    // Auto-seed a sample project tuned to the band so the user lands on
    // a populated home screen instead of an empty state. The dynamic
    // require keeps demoSeed.ts out of the onboarding bundle until we
    // actually need it.
    try {
      const flavor = suggestedDemoFlavorForBand(band);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { seedDemoProject } = require('@/utils/demoSeed');
      await seedDemoProject({
        addProject: projectCtx.addProject,
        addInvoice: projectCtx.addInvoice,
        addDailyReport: projectCtx.addDailyReport,
        addPunchItem: projectCtx.addPunchItem,
        addProjectPhoto: projectCtx.addProjectPhoto,
        addRFI: projectCtx.addRFI,
        addChangeOrder: projectCtx.addChangeOrder,
        flavor,
      });
    } catch (e) {
      // Non-fatal — user lands on home with empty state if seeding fails.
      console.log('[onboarding] auto-seed skipped:', e);
    }
    void finishToHome();
  }, [finishToHome, projectCtx]);

  const handleSkip = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    void finishToHome();
  }, [finishToHome]);

  return (
    <View style={styles.root}>
      {/* Background — soft mesh gradient. Two stacked LinearGradients give
          us a "light through glass" effect: deep green below, a warm
          orange glow up top-right that shifts the mood without going
          loud. Edge-to-edge, behind the safe area. */}
      <LinearGradient
        colors={[BRAND.greenDeep, BRAND.green, BRAND.green, BRAND.greenDeep]}
        locations={[0, 0.35, 0.7, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        colors={[BRAND.orangeHot + '38', 'transparent']}
        start={{ x: 0.85, y: 0 }}
        end={{ x: 0.2, y: 0.6 }}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        colors={['transparent', BRAND.orange + '14']}
        start={{ x: 0.1, y: 0.7 }}
        end={{ x: 0.6, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

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

      {/* Step indicator — three dots for splash → preview → routing.
          The active dot grows wider; non-active stay small. */}
      <View style={styles.stepDots}>
        <View style={[styles.stepDot, step === 'splash' && styles.stepDotActive]} />
        <View style={[styles.stepDot, step === 'preview' && styles.stepDotActive]} />
        <View style={[styles.stepDot, step === 'routing' && styles.stepDotActive]} />
      </View>

      {/* Body — switches between splash and routing. Both use the same
          reveal animations so the transition feels coherent. */}
      {step === 'splash' && (
        <Animated.View
          style={[
            styles.body,
            { paddingBottom: insets.bottom + 24, transform: [{ translateY: lift }] },
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
              tapping "Get started" know the deal. Three short bullets,
              one mono-spaced row, separated by middots. Tucked above
              the CTA so it lands in the user's eye line before the tap. */}
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

          <Animated.View style={{ opacity: ctaOpacity, marginTop: 14 }}>
            <TouchableOpacity onPress={handleSignIn} hitSlop={8}>
              <Text style={styles.signInText}>
                Already have an account?  <Text style={styles.signInLink}>Sign in</Text>
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      )}

      {step === 'preview' && (
        <Animated.View
          style={[
            styles.body,
            { paddingBottom: insets.bottom + 24, transform: [{ translateY: lift }] },
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

          {/* Three preview cards. Each is a single-line title + short body
              with a brand-color icon tile. No fake screenshots; the value
              prop is encoded in the copy. */}
          <Animated.View style={[styles.previewList, { opacity: bodyOpacity }]}>
            {PREVIEW_CARDS.map((card, i) => {
              const Icon = card.Icon;
              return (
                <View key={i} style={styles.previewCard}>
                  <View style={styles.previewIcon}>
                    <Icon size={18} color={BRAND.orange} strokeWidth={2.2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.previewTitle}>{card.title}</Text>
                    <Text style={styles.previewBody}>{card.body}</Text>
                  </View>
                </View>
              );
            })}
          </Animated.View>

          <Animated.View style={{ opacity: ctaOpacity, marginTop: Tokens.spacing.lg, transform: [{ scale: ctaScale }] }}>
            <Pressable
              onPress={handlePreviewNext}
              style={({ pressed }) => [styles.ctaPrimary, pressed && { opacity: 0.92 }]}
              accessibilityLabel="Continue to setup"
              testID="onboarding-preview-next"
            >
              <Text style={styles.ctaPrimaryText}>Sounds good</Text>
              <ArrowRight size={18} color={BRAND.ink} strokeWidth={2.4} />
            </Pressable>
          </Animated.View>

          {/* Sign-in link — consistent with splash. Returning users
              who accidentally tap "Get started" can recover without
              going back. */}
          <Animated.View style={{ opacity: ctaOpacity, marginTop: 14 }}>
            <TouchableOpacity onPress={handleSignIn} hitSlop={8}>
              <Text style={styles.signInText}>
                Already have an account?  <Text style={styles.signInLink}>Sign in</Text>
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      )}

      {step === 'routing' && (
        <Animated.View
          style={[
            styles.body,
            { paddingBottom: insets.bottom + 24, transform: [{ translateY: lift }] },
          ]}
        >
          <View style={{ flex: 1 }} />

          <Animated.Text style={[styles.eyebrow, { opacity: eyebrowOpacity }]}>
            <Text style={styles.eyebrowDot}>●</Text>  one quick question
          </Animated.Text>

          <Animated.Text style={[styles.headline, { opacity: headlineOpacity }]}>
            <Text style={styles.headlineRoman}>How big is{' '}</Text>
            <Text style={styles.headlineItalic}>your typical{' '}</Text>
            <Text style={styles.headlineRoman}>job?</Text>
          </Animated.Text>

          <Animated.Text style={[styles.lede, { opacity: bodyOpacity }]}>
            We&apos;ll set the right defaults so estimates, schedules, and the AI feel
            tuned to how you actually work. Change anytime in settings.
          </Animated.Text>

          <Animated.View style={[styles.bandList, { opacity: ctaOpacity }]}>
            {(['under_1m', '1_to_5m', '5_to_15m', 'over_15m'] as ProjectSizeBand[]).map(band => (
              <Pressable
                key={band}
                onPress={() => handleBandPick(band)}
                style={({ pressed }) => [
                  styles.bandCard,
                  pressed && styles.bandCardPressed,
                ]}
                accessibilityLabel={`I run jobs ${SIZE_BAND_LABELS[band]} — ${SIZE_BAND_PERSONA[band]}`}
                accessibilityRole="button"
                testID={`onboarding-band-${band}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.bandLabel}>{SIZE_BAND_LABELS[band]}</Text>
                  <Text style={styles.bandPersona} numberOfLines={2}>
                    {SIZE_BAND_PERSONA[band]}
                  </Text>
                </View>
                <View style={styles.bandArrow}>
                  <ArrowRight size={16} color={BRAND.cream} strokeWidth={2.2} />
                </View>
              </Pressable>
            ))}
          </Animated.View>

          <Animated.View style={{ opacity: ctaOpacity, marginTop: Tokens.spacing.sm }}>
            <TouchableOpacity onPress={handleSkip} hitSlop={8}>
              <Text style={styles.signInText}>
                <Text style={styles.signInLink}>Skip — pick later</Text>
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
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
    paddingHorizontal: Tokens.spacing.lg,
    paddingBottom: Tokens.spacing.xs,
  },
  wordmark: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800',
    letterSpacing: 2,
    color: BRAND.cream,
  },
  skipBtn: {
    paddingHorizontal: 14,
    paddingVertical: Tokens.spacing.xs,
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
    paddingHorizontal: Tokens.spacing.xl,
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
    marginBottom: Tokens.spacing.lg,
    maxWidth: 520,
  },

  // Trust line — small, mono-ish, sits between the lede and the CTA.
  // Sets pricing expectations upfront. Cream at 80% so it reads without
  // competing with the headline.
  trustLine: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: 'rgba(244,239,230,0.78)',
    letterSpacing: 0.4,
    marginBottom: Tokens.spacing.xl,
    textTransform: 'uppercase' as const,
  },

  ctaPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Tokens.spacing.xs,
    backgroundColor: BRAND.cream,
    paddingHorizontal: 22,
    paddingVertical: Tokens.spacing.md,
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
    marginTop: Tokens.spacing.xxs,
  },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Tokens.spacing.sm,
    paddingHorizontal: Tokens.spacing.md,
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
    marginTop: Tokens.spacing.xxs,
    lineHeight: 18,
  },

  // ── Routing card list ───────────────────────────────────────────
  bandList: {
    gap: 10,
    marginTop: Tokens.spacing.xxs,
  },
  bandCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Tokens.spacing.sm,
    paddingHorizontal: Tokens.spacing.md,
    paddingVertical: Tokens.spacing.md,
    borderRadius: Tokens.radius.lg,
    ...continuousCorners,
    backgroundColor: 'rgba(244,239,230,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(244,239,230,0.12)',
    minHeight: 64, // generous touch target — premium bar
  },
  bandCardPressed: {
    backgroundColor: 'rgba(255,106,26,0.18)',
    borderColor: BRAND.orange,
  },
  bandLabel: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800',
    color: BRAND.cream,
    letterSpacing: -0.2,
  },
  bandPersona: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '500',
    color: BRAND.fog,
    marginTop: Tokens.spacing.xxs,
    lineHeight: 16,
  },
  bandArrow: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.full,
    backgroundColor: 'rgba(244,239,230,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// Suppress the "unused" warning for the Check icon — kept in the import
// list so a follow-up can show "✓ Personalized" feedback after band pick.
void Check;
