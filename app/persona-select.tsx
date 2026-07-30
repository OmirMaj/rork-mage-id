// app/persona-select.tsx — first thing a new user sees after sign-up.
//
// We ask exactly one question — "what brings you here?" — and route
// the rest of onboarding off the answer. The original product was
// contractor-only; the 'client' branch unlocks the property-owner /
// real-estate persona (post-RFP, hire, manage at arm's length). 'both'
// keeps both surfaces accessible behind a persona toggle in Settings.
//
// Design intentionally mirrors app/onboarding.tsx so the two screens
// feel like one continuous flow: same greenDeep gradient bg, same
// Fraunces serif headline with italic emphasis, same cream "band card"
// CTA pattern. The persona pick is more consequential than the
// size-band question (it changes the whole UI), so this screen comes
// FIRST — the existing onboarding follows after.
//
// Routing: handled by app/_layout.tsx based on `userRole` from
// ProjectContext. If null → /persona-select. Once set → /onboarding
// (or skip directly to /(tabs)/(home) if onboarding already complete,
// e.g. a user revisits this screen from Settings to change persona).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Alert,
  Easing,
  Pressable,
  Dimensions,
  AccessibilityInfo,
} from 'react-native';
import PersonaSwitchOverlay from '@/components/PersonaSwitchOverlay';
import { continuousCorners, Tokens } from '@/constants/designTokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { track, AnalyticsEvents } from '@/utils/analytics';
import { ArrowRight, HardHat, Home, Repeat, Building2 } from 'lucide-react-native';
import { BrandBackdrop } from '@/components/BrandBackdrop';
import { Type } from '@/constants/typography';
import { useCoreData, useProjectActions } from '@/contexts/ProjectContext';
import {
  USER_ROLE_LABELS,
  USER_ROLE_BLURB,
  type UserRole,
} from '@/utils/onboardingProfile';

// Same brand palette as onboarding.tsx — kept hardcoded so the splash
// looks identical regardless of any custom-primary the user might set
// later in Settings. Two screens, one continuous look.
const BRAND = {
  // Brand amber on ink (the green preset was off-brand).
  green: '#FF6A1A',
  greenDeep: '#0B0D10',
  greenAccent: '#FF8533',
  orange: '#FF6A1A',
  orangeHot: '#FF8533',
  cream: '#F4EFE6',
  ink: '#0B0D10',
  fog: 'rgba(244,239,230,0.62)',
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Icon paired with each persona card. Chosen for at-a-glance legibility,
// not for industry cliché — HardHat reads as "I work in construction",
// Home as "I own property", Repeat as "I do both" without needing the label.
const ROLE_ICONS: Record<UserRole, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  contractor: HardHat,
  client: Home,
  both: Repeat,
  property_manager: Building2,
};

const ROLES: UserRole[] = ['contractor', 'client', 'both', 'property_manager'];

export default function PersonaSelectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { hasSeenOnboarding } = useCoreData();
  const { setUserRole, completeOnboarding } = useProjectActions();

  const { isDesktop } = useResponsiveLayout();

  const [submitting, setSubmitting] = useState<UserRole | null>(null);

  // ── Persona-switch overlay ─────────────────────────────────────────────────
  // showOverlay drives the full-screen circular reveal animation.
  // pendingRole / pendingOrigin store the selection until onDone fires.
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayRole, setOverlayRole] = useState<UserRole>('contractor');
  const [overlayOrigin, setOverlayOrigin] = useState<{ x: number; y: number } | undefined>();
  // One ref per role card for measureInWindow origin capture
  const cardRefs = useRef<Record<UserRole, View | null>>({
    contractor: null,
    client: null,
    both: null,
    property_manager: null,
  });
  // Stores the actual commit logic until the animation's peak (onDone)
  const pendingCommit = useRef<(() => Promise<void>) | null>(null);

  // Reduce-motion handling matches onboarding.tsx — Apple HIG requires
  // it and skipping the animation also means we don't gate the user on
  // a 600ms reveal when accessibility is on.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => {
      if (mounted) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);

  // Staggered reveal — same easing/timing as onboarding so the two
  // screens feel like one motion language.
  const eyebrowOpacity = useRef(new Animated.Value(0)).current;
  const headlineOpacity = useRef(new Animated.Value(0)).current;
  const bodyOpacity = useRef(new Animated.Value(0)).current;
  const cardsOpacity = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    if (reduceMotion) {
      Animated.parallel([
        Animated.timing(eyebrowOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(headlineOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(bodyOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(cardsOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      lift.setValue(0);
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
        Animated.timing(cardsOpacity, { toValue: 1, duration: 360, useNativeDriver: true }),
      ]),
    ]).start();
  }, [reduceMotion, eyebrowOpacity, headlineOpacity, bodyOpacity, cardsOpacity, lift]);

  // commitRole — the actual async logic that runs when the overlay's reveal
  // peak fires (onDone). Separated so the animation can play uninterrupted
  // while the role write + navigation are deferred to the overlay's callback.
  const commitRole = useCallback(async (role: UserRole) => {
    try {
      await setUserRole(role);
      track(AnalyticsEvents.PERSONA_SELECTED, { persona: role, onboarding: !hasSeenOnboarding });

      // Routing after pick has three paths:
      //   1. Existing user changing persona from Settings (hasSeenOnboarding
      //      is true): drop straight on home — they've seen onboarding once,
      //      we don't re-prompt for trade size.
      //   2. NEW client persona: skip the contractor-specific "how big is
      //      your typical job?" onboarding entirely — that question is
      //      meaningless for property owners, and the auto-seeded "Sample
      //      Henderson Residence" with materials breakdown would be more
      //      confusing than empty state on the client home (which has its
      //      own zero state + Post a Project CTA).
      //   3. NEW contractor or 'both': continue into the existing
      //      onboarding for size-band capture + sample seed.
      if (hasSeenOnboarding) {
        router.replace('/(tabs)/(home)' as never);
      } else if (role === 'client' || role === 'property_manager') {
        // The contractor "how big is your typical job?" onboarding is
        // meaningless for these personas — skip straight to their hub,
        // which carries its own zero-state CTA.
        await completeOnboarding();
        router.replace('/(tabs)/(home)' as never);
      } else {
        router.replace('/onboarding' as never);
      }
    } catch (err) {
      console.warn('[persona-select] failed to set role:', err);
      setSubmitting(null);
      // Web-safe via patchAlertForWeb() in app/_layout.tsx — new-user
      // flow must never silent-fail on first tap.
      Alert.alert(
        "Couldn't save your choice",
        'Please tap your role again.',
      );
    }
  }, [hasSeenOnboarding, router, setUserRole, completeOnboarding]);

  const handlePick = useCallback((role: UserRole) => {
    if (submitting) return;
    setSubmitting(role);

    // Store the commit for when the overlay's onDone fires
    pendingCommit.current = () => commitRole(role);

    // Measure the tapped card for reveal origin; fall back to screen center
    const ref = cardRefs.current[role];
    if (ref && typeof ref.measureInWindow === 'function') {
      ref.measureInWindow((cx, cy, cw, ch) => {
        setOverlayOrigin({ x: cx + cw / 2, y: cy + ch / 2 });
        setOverlayRole(role);
        setShowOverlay(true);
      });
    } else {
      setOverlayRole(role);
      setShowOverlay(true);
    }
  }, [submitting, commitRole]);

  // Called when the overlay animation completes — commit the role + navigate
  const handleOverlayDone = useCallback(async () => {
    setShowOverlay(false);
    if (pendingCommit.current) {
      await pendingCommit.current();
      pendingCommit.current = null;
    }
  }, []);

  return (
    <View style={styles.root}>
      {/* Background — ink field with corner accent glows (shared with
          onboarding.tsx via BrandBackdrop; accent is NOT the field). */}
      <BrandBackdrop />

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.wordmark}>MAGE&nbsp;ID</Text>
        {/* No Skip — this question routes the entire app, can't be deferred. */}
      </View>

      <Animated.View
        style={[
          styles.body,
          isDesktop && styles.centerWrap,
          { paddingBottom: insets.bottom + 24, transform: [{ translateY: lift }] },
        ]}
      >
        <View style={{ flex: 1 }} />

        <Animated.Text style={[styles.eyebrow, { opacity: eyebrowOpacity }]}>
          <Text style={styles.eyebrowDot}>●</Text>  pick your side
        </Animated.Text>

        <Animated.Text style={[styles.headline, { opacity: headlineOpacity }]}>
          <Text style={styles.headlineRoman}>What brings{' '}</Text>
          <Text style={styles.headlineItalic}>you{' '}</Text>
          <Text style={styles.headlineRoman}>here?</Text>
        </Animated.Text>

        <Animated.Text style={[styles.lede, { opacity: bodyOpacity }]}>
          MAGE ID has two sides — the operating system for builders, and a marketplace
          for property owners hiring them. Pick one and we&apos;ll set up the right experience.
          You can switch later in Settings.
        </Animated.Text>

        <Animated.View style={[styles.cardList, isDesktop && styles.cardGrid, { opacity: cardsOpacity }]}>
          {ROLES.map(role => {
            const Icon = ROLE_ICONS[role];
            const isSubmitting = submitting === role;
            return (
              <View
                key={role}
                ref={r => { cardRefs.current[role] = r; }}
                collapsable={false}
              >
                <Pressable
                  onPress={() => handlePick(role)}
                  disabled={!!submitting}
                  style={({ pressed, hovered }) => [
                    styles.roleCard,
                    isDesktop && styles.cardHalf,
                    hovered && styles.roleCardHover,
                    pressed && styles.roleCardPressed,
                    isSubmitting && styles.roleCardActive,
                  ]}
                  accessibilityLabel={`${USER_ROLE_LABELS[role]}: ${USER_ROLE_BLURB[role]}`}
                  accessibilityRole="button"
                  testID={`persona-${role}`}
                >
                  <View style={styles.roleIconWrap}>
                    <Icon size={22} color={BRAND.orange} strokeWidth={2.2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roleLabel}>{USER_ROLE_LABELS[role]}</Text>
                    <Text style={styles.roleBlurb} numberOfLines={3}>
                      {USER_ROLE_BLURB[role]}
                    </Text>
                  </View>
                  <View style={styles.roleArrow}>
                    <ArrowRight size={16} color={BRAND.cream} strokeWidth={2.2} />
                  </View>
                </Pressable>
              </View>
            );
          })}
        </Animated.View>

        <Animated.Text style={[styles.trustLine, { opacity: cardsOpacity }]}>
          You can change this anytime in Settings
        </Animated.Text>
      </Animated.View>

      {/* Circular reveal transition when the user picks a new persona */}
      <PersonaSwitchOverlay
        visible={showOverlay}
        toRole={overlayRole}
        originPoint={overlayOrigin}
        reduceMotion={reduceMotion}
        onDone={handleOverlayDone}
      />
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

  body: {
    flex: 1,
    paddingHorizontal: 24,
  },

  centerWrap: { width: '100%', alignSelf: 'center', maxWidth: 900 },

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
    marginBottom: 24,
    maxWidth: 520,
  },

  // ── Role cards — same band-card recipe used in onboarding's routing
  //    question, with an icon tile prepended.
  cardList: {
    gap: 10,
    marginTop: 4,
  },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cardHalf: { flexBasis: '48%', flexGrow: 1, minWidth: 200 },
  roleCard: {
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
    minHeight: 84,
  },
  roleCardHover: {
    backgroundColor: 'rgba(255,106,26,0.10)',
    borderColor: BRAND.orange,
  },
  roleCardPressed: {
    backgroundColor: 'rgba(255,106,26,0.18)',
    borderColor: BRAND.orange,
  },
  roleCardActive: {
    backgroundColor: 'rgba(255,106,26,0.22)',
    borderColor: BRAND.orange,
    opacity: 0.85,
  },
  roleIconWrap: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.md,
    backgroundColor: 'rgba(255,106,26,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,106,26,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleLabel: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800',
    color: BRAND.cream,
    letterSpacing: -0.2,
  },
  roleBlurb: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '500',
    color: BRAND.fog,
    marginTop: 4,
    lineHeight: 16,
  },
  roleArrow: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.full,
    backgroundColor: 'rgba(244,239,230,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  trustLine: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: 'rgba(244,239,230,0.62)',
    letterSpacing: 0.4,
    marginTop: 18,
    textAlign: 'center',
    textTransform: 'uppercase' as const,
  },
});

// Suppress unused warning — TouchableOpacity is imported in case a future
// follow-up wants a "Back" or "Sign in instead" affordance here.
void TouchableOpacity;
