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
import { parseSeedBlob, draftsToSeeds, type SeedParseResult } from '@/utils/costSeedCore';
import { useCostSeeds } from '@/hooks/useCostSeeds';
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

// Three-step flow: splash → preview cards → rates (terminal → estimate wizard).
type Step = 'splash' | 'preview' | 'rates';

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
  const { completeOnboarding } = useProjects();
  const { addSeeds } = useCostSeeds();
  const { colors: themeColors } = useTheme();

  const [step, setStep] = useState<Step>('splash');

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

  // Activation funnel — mark the top of the rates step so we can compute
  // viewed→completed. Fires once when the step first renders.
  useEffect(() => {
    if (step === 'rates') track(AnalyticsEvents.ONBOARDING_RATES_VIEWED);
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
    setStep('rates');
  }, []);

  const handleSignIn = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    router.push('/login' as never);
  }, [router]);

  // Terminal hand-off — lands the user inside the estimate wizard so they
  // price a real bid before anything asks them to upgrade. Called by both
  // the "Price your first bid →" CTA and the "I'll add rates later" skip.
  // completeOnboarding() sets hasSeenOnboarding so the user is never
  // re-looped back here. No demo-seed: the wizard itself is the aha.
  const goPriceFirstBid = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await completeOnboarding();
    router.replace('/estimate-wizard?onboarding=1' as never);
  }, [completeOnboarding, router]);

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
  // Goes straight to the paywall (not the estimate wizard) — a hard-skipper
  // on the splash or preview steps shouldn't be forced into the wizard arc.
  const handleSkip = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await completeOnboarding();
    router.replace('/onboarding-paywall' as never);
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
      <View style={styles.stepDots}>
        <View style={[styles.stepDot, step === 'splash' && styles.stepDotActive]} />
        <View style={[styles.stepDot, step === 'preview' && styles.stepDotActive]} />
        <View style={[styles.stepDot, step === 'rates' && styles.stepDotActive]} />
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
              { paddingBottom: insets.bottom + 24, transform: [{ translateY: lift }] },
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
