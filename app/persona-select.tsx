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
import { ArrowRight, HardHat, Home, Repeat } from 'lucide-react-native';
import { Type } from '@/constants/typography';
import { useProjects, useProjectActions } from '@/contexts/ProjectContext';
import {
  USER_ROLE_LABELS,
  USER_ROLE_BLURB,
  type UserRole,
} from '@/utils/onboardingProfile';

// Same brand palette as onboarding.tsx — kept hardcoded so the splash
// looks identical regardless of any custom-primary the user might set
// later in Settings. Two screens, one continuous look.
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

// Icon paired with each persona card. Chosen for at-a-glance legibility,
// not for industry cliché — HardHat reads as "I work in construction",
// Home as "I own property", Repeat as "I do both" without needing the label.
const ROLE_ICONS: Record<UserRole, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  contractor: HardHat,
  client: Home,
  both: Repeat,
};

const ROLES: UserRole[] = ['contractor', 'client', 'both'];

export default function PersonaSelectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { hasSeenOnboarding } = useProjects();
  const { setUserRole } = useProjectActions();

  const [submitting, setSubmitting] = useState<UserRole | null>(null);

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

  const handlePick = useCallback(async (role: UserRole) => {
    if (submitting) return;
    setSubmitting(role);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await setUserRole(role);
      // If onboarding is already done (user came here to *change* persona
      // from Settings), drop them straight on home — don't re-run the
      // size-band question. Otherwise continue into the existing onboarding
      // flow which captures size-band + auto-seeds a sample project.
      if (hasSeenOnboarding) {
        router.replace('/(tabs)/(home)' as never);
      } else {
        router.replace('/onboarding' as never);
      }
    } catch (err) {
      console.warn('[persona-select] failed to set role:', err);
      setSubmitting(null);
    }
  }, [hasSeenOnboarding, router, setUserRole, submitting]);

  return (
    <View style={styles.root}>
      {/* Background — same layered gradient recipe as onboarding.tsx. */}
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

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.wordmark}>MAGE&nbsp;ID</Text>
        {/* No Skip — this question routes the entire app, can't be deferred. */}
      </View>

      <Animated.View
        style={[
          styles.body,
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

        <Animated.View style={[styles.cardList, { opacity: cardsOpacity }]}>
          {ROLES.map(role => {
            const Icon = ROLE_ICONS[role];
            const isSubmitting = submitting === role;
            return (
              <Pressable
                key={role}
                onPress={() => handlePick(role)}
                disabled={!!submitting}
                style={({ pressed }) => [
                  styles.roleCard,
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
            );
          })}
        </Animated.View>

        <Animated.Text style={[styles.trustLine, { opacity: cardsOpacity }]}>
          You can change this anytime in Settings
        </Animated.Text>
      </Animated.View>
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
