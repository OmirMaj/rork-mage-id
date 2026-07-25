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
  TextInput,
  TouchableOpacity,
  Animated,
  Easing,
  Platform,
  Pressable,
  Dimensions,
  AccessibilityInfo,
  KeyboardAvoidingView,
} from 'react-native';
import { continuousCorners, Tokens } from '@/constants/designTokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ArrowRight, Check, Ruler, Mic, TrendingUp } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { BrandBackdrop } from '@/components/BrandBackdrop';
import { useProjects } from '@/contexts/ProjectContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import {
  saveOnboardingProfile,
  SIZE_BAND_LABELS,
  SIZE_BAND_PERSONA,
  suggestedDemoFlavorForBand,
  type ProjectSizeBand,
} from '@/utils/onboardingProfile';
import { parseImportBlob, draftToLeadInput, type ImportedLeadDraft } from '@/utils/pipelineImport';
import { track, AnalyticsEvents } from '@/utils/analytics';

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

type Step = 'splash' | 'preview' | 'routing' | 'import';

// Flavor of the auto-seeded sample project. Derived from the size band on
// the routing step. Inferred from suggestedDemoFlavorForBand so we don't
// have to re-name the union here.
type DemoFlavor = ReturnType<typeof suggestedDemoFlavorForBand>;

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
    body: 'Try it free — build an AI estimate or dictate a report. See the wow before anything asks you to upgrade.',
    isTryIt: true,
  },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const projectCtx = useProjects();
  const { completeOnboarding, addLead } = projectCtx;
  const { colors: themeColors } = useTheme();

  const [step, setStep] = useState<Step>('splash');

  // Card-stack progressive disclosure — which preview card is showing.
  const [cardIndex, setCardIndex] = useState(0);

  // ── Import-your-pipeline step state. The size band picked on the routing
  // step is held here until the import step finishes, so we can seed a tuned
  // demo project only when the user *skips* import (a real paste makes their
  // own clients the populated state — no fake sample project needed).
  const [pendingBand, setPendingBand] = useState<ProjectSizeBand | null>(null);
  const [blob, setBlob] = useState('');
  const [drafts, setDrafts] = useState<ImportedLeadDraft[]>([]);
  const [parsed, setParsed] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importHint, setImportHint] = useState<string | null>(null);

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

  // Activation funnel — mark the top of the import step so we can compute
  // viewed→completed. Fires once when the step first renders.
  useEffect(() => {
    if (step === 'import') track(AnalyticsEvents.ONBOARDING_IMPORT_VIEWED);
  }, [step]);

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

  // Seed a sample project tuned to the size band so a user who *doesn't*
  // bring their own pipeline still lands on a populated home instead of an
  // empty state. The dynamic require keeps demoSeed.ts out of the onboarding
  // bundle until we actually need it. Non-fatal — empty state on failure.
  const runDemoSeed = useCallback(async (flavor: DemoFlavor) => {
    try {
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
      console.warn('[onboarding] auto-seed skipped:', e);
    }
  }, [projectCtx]);

  // Single exit. `seedDemo` is true only when the user lands on home without
  // having imported a real pipeline (skip paths) — see the routing/import
  // handlers below.
  const finishToHome = useCallback(async (opts?: { seedDemo?: boolean; band?: ProjectSizeBand | null }) => {
    if (opts?.seedDemo) {
      const flavor: DemoFlavor = opts.band ? suggestedDemoFlavorForBand(opts.band) : 'medium';
      await runDemoSeed(flavor);
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await completeOnboarding();
    router.replace('/onboarding-paywall' as never);
  }, [runDemoSeed, completeOnboarding, router]);

  const handleBandPick = useCallback(async (band: ProjectSizeBand) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await saveOnboardingProfile({
      completedAt: new Date().toISOString(),
      sizeBand: band,
    });
    // Don't seed yet — advance to the import step. If they paste a real
    // pipeline there we skip the sample project entirely; if they skip
    // import, finishToHome seeds a band-tuned demo so home isn't empty.
    setPendingBand(band);
    setStep('import');
  }, []);

  // ── Import step ──────────────────────────────────────────────────────
  const handleParse = useCallback(() => {
    const next = parseImportBlob(blob);
    if (next.length === 0) {
      setImportHint('Paste one client per line — name first, then phone, email, project, or budget in any order.');
      return;
    }
    setImportHint(null);
    setDrafts(next);
    setParsed(true);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [blob]);

  const handleImport = useCallback(async () => {
    if (drafts.length === 0) return;
    setImporting(true);
    try {
      for (const d of drafts) addLead(draftToLeadInput(d));
      track(AnalyticsEvents.ONBOARDING_IMPORT_COMPLETED, { count: drafts.length });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Real pipeline imported → their clients ARE the populated state, so
      // skip the demo seed.
      await finishToHome({ seedDemo: false });
    } finally {
      setImporting(false);
    }
  }, [drafts, addLead, finishToHome]);

  const handleImportSkip = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    track(AnalyticsEvents.ONBOARDING_IMPORT_SKIPPED);
    void finishToHome({ seedDemo: true, band: pendingBand });
  }, [finishToHome, pendingBand]);

  // Top-bar Skip — bails out of the whole flow. Seeds a sample project so
  // the user still lands on a populated home. `pendingBand` is null unless
  // they'd already reached the import step, in which case we honor it.
  const handleSkip = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    void finishToHome({ seedDemo: true, band: pendingBand });
  }, [finishToHome, pendingBand]);

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

      {/* Step indicator — three dots for splash → preview → routing.
          The active dot grows wider; non-active stay small. */}
      <View style={styles.stepDots}>
        <View style={[styles.stepDot, step === 'splash' && styles.stepDotActive]} />
        <View style={[styles.stepDot, step === 'preview' && styles.stepDotActive]} />
        <View style={[styles.stepDot, step === 'routing' && styles.stepDotActive]} />
        <View style={[styles.stepDot, step === 'import' && styles.stepDotActive]} />
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

          {/* Card-stack progressive disclosure — one beat at a time. Tap the
              card (or the CTA) to reveal the next; the final "try it" card
              advances the flow. Progress pips show position. */}
          <Animated.View style={[styles.previewList, { opacity: bodyOpacity }]}>
            {(() => {
              const card = PREVIEW_CARDS[Math.min(cardIndex, PREVIEW_CARDS.length - 1)];
              const Icon = card.Icon;
              const isLast = cardIndex >= PREVIEW_CARDS.length - 1;
              const advance = () => {
                if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (isLast) { handlePreviewNext(); return; }
                setCardIndex(i => i + 1);
              };
              return (
                <>
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

                  <View style={styles.pipRow}>
                    {PREVIEW_CARDS.map((_, i) => (
                      <View key={i} style={[styles.pip, i === cardIndex && styles.pipActive]} />
                    ))}
                  </View>

                  <Animated.View style={{ opacity: ctaOpacity, marginTop: 8, transform: [{ scale: ctaScale }] }}>
                    <Pressable
                      onPress={advance}
                      style={({ pressed }) => [styles.ctaPrimary, styles.ctaWide, pressed && { opacity: 0.92 }]}
                      accessibilityLabel={isLast ? 'Continue to setup' : 'Next'}
                      testID="onboarding-preview-next"
                    >
                      <Text style={styles.ctaPrimaryText}>{isLast ? 'Let’s go' : 'Next'}</Text>
                      <ArrowRight size={18} color={BRAND.ink} strokeWidth={2.4} />
                    </Pressable>
                  </Animated.View>
                </>
              );
            })()}
          </Animated.View>

          {/* Sign-in link — consistent with splash. Returning users
              who accidentally tap "Get started" can recover from any
              step without going back. */}
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

          <Animated.View style={{ opacity: ctaOpacity, marginTop: 12 }}>
            <TouchableOpacity onPress={handleSkip} hitSlop={8}>
              <Text style={styles.signInText}>
                <Text style={styles.signInLink}>Skip — pick later</Text>
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      )}

      {/* Import-your-pipeline — the "bring your own clients" cold-start play
          lands right here in first-run. Paste a client column, tap once, and
          land on home with a populated pipeline instead of an empty CRM —
          each lead one tap from an Instant Bid. Reuses the shared parser
          (utils/pipelineImport); only the brand-styled UI is local. */}
      {step === 'import' && (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 72}
        >
          <Animated.View
            style={[
              styles.body,
              { paddingBottom: insets.bottom + 24, transform: [{ translateY: lift }] },
            ]}
          >
            <View style={{ flex: 1 }} />

            <Animated.Text style={[styles.eyebrow, { opacity: eyebrowOpacity }]}>
              <Text style={styles.eyebrowDot}>●</Text>  bring your book of business
            </Animated.Text>

            <Animated.Text style={[styles.headline, { opacity: headlineOpacity }]}>
              <Text style={styles.headlineRoman}>Bring your{' '}</Text>
              <Text style={styles.headlineItalic}>clients{' '}</Text>
              <Text style={styles.headlineRoman}>with you.</Text>
            </Animated.Text>

            {!parsed ? (
              <Animated.View style={{ opacity: bodyOpacity }}>
                <Text style={styles.lede}>
                  Paste your client list — one per line. We&apos;ll read the name, phone,
                  email, project, and budget in any order. Each becomes a lead, ready for
                  an Instant Bid.
                </Text>
                <TextInput
                  style={styles.pasteInput}
                  value={blob}
                  onChangeText={(v) => { setBlob(v); setImportHint(null); }}
                  placeholder={'John Smith, 555-123-4567, kitchen remodel, $80,000\nJane Garcia, jane@email.com, bathroom reno\nPatel Family, 312-555-0199, ADU, 150k'}
                  placeholderTextColor={BRAND.fog}
                  multiline
                  textAlignVertical="top"
                  testID="onboarding-import-blob"
                />
                {!!importHint && <Text style={styles.importHint}>{importHint}</Text>}
                <Pressable
                  onPress={handleParse}
                  disabled={!blob.trim()}
                  style={({ pressed }) => [
                    styles.ctaPrimary,
                    styles.ctaWide,
                    !blob.trim() && { opacity: 0.5 },
                    pressed && { opacity: 0.92 },
                  ]}
                  accessibilityLabel="Review clients to import"
                  accessibilityRole="button"
                  testID="onboarding-import-review"
                >
                  <Text style={styles.ctaPrimaryText}>Review clients</Text>
                  <ArrowRight size={18} color={BRAND.ink} strokeWidth={2.4} />
                </Pressable>
                <TouchableOpacity
                  onPress={handleImportSkip}
                  hitSlop={8}
                  style={styles.importSkip}
                  testID="onboarding-import-skip"
                >
                  <Text style={styles.signInText}>
                    <Text style={styles.signInLink}>Skip — I&apos;ll add them later</Text>
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            ) : (
              <Animated.View style={{ opacity: bodyOpacity }}>
                <View style={styles.confirmCard}>
                  <View style={styles.confirmHeadRow}>
                    <MageAIMark size={16} color={BRAND.orange} />
                    <Text style={styles.confirmCount}>
                      {drafts.length} client{drafts.length === 1 ? '' : 's'} ready to import
                    </Text>
                  </View>
                  <View style={styles.nameChipRow}>
                    {drafts.slice(0, 6).map((d, i) => (
                      <View key={`${d.raw}-${i}`} style={styles.nameChip}>
                        <Text style={styles.nameChipText} numberOfLines={1}>{d.name}</Text>
                      </View>
                    ))}
                    {drafts.length > 6 && (
                      <View style={styles.nameChip}>
                        <Text style={styles.nameChipText}>+{drafts.length - 6} more</Text>
                      </View>
                    )}
                  </View>
                </View>
                <Pressable
                  onPress={handleImport}
                  disabled={importing}
                  style={({ pressed }) => [
                    styles.ctaPrimary,
                    styles.ctaWide,
                    importing && { opacity: 0.6 },
                    pressed && { opacity: 0.92 },
                  ]}
                  accessibilityLabel={`Import ${drafts.length} clients`}
                  accessibilityRole="button"
                  testID="onboarding-import-commit"
                >
                  <Check size={18} color={BRAND.ink} strokeWidth={2.6} />
                  <Text style={styles.ctaPrimaryText}>
                    Import {drafts.length} client{drafts.length === 1 ? '' : 's'}
                  </Text>
                </Pressable>
                <TouchableOpacity
                  onPress={() => setParsed(false)}
                  hitSlop={8}
                  style={styles.importSkip}
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

  // ── Routing card list ───────────────────────────────────────────
  bandList: {
    gap: 10,
    marginTop: 4,
  },
  bandCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
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
    marginTop: 4,
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

  // ── Import-your-pipeline step ───────────────────────────────────────
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
  importHint: {
    fontSize: Type.footnote.fontSize,
    color: BRAND.orangeHot,
    lineHeight: 18,
    marginBottom: 12,
  },
  importSkip: {
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
});
