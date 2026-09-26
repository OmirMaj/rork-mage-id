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
// Motion (slick-3): the tapped card lifts into the overlay's "switching
// workspace" card while the role is written; the list hides under the scrim;
// the route changes the moment the overlay has unmounted (no dead time, never
// back to the list).
//
// Routing: handled by app/_layout.tsx based on `userRole` from
// ProjectContext. If null → /persona-select. Once set → /onboarding
// (or skip directly to /(tabs)/(home) if onboarding already complete,
// e.g. a user revisits this screen from Settings to change persona).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Pressable, Dimensions,
} from 'react-native';
import PersonaSwitchOverlay from '@/components/PersonaSwitchOverlay';
import { continuousCorners, Motion, Tokens } from '@/constants/designTokens';
import { nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { takePendingDeepLink } from '@/utils/pendingDeepLink';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { track, AnalyticsEvents } from '@/utils/analytics';
import { ArrowRight, HardHat, Home, Repeat, Building2 } from 'lucide-react-native';
import { BrandBackdrop } from '@/components/BrandBackdrop';
import { Type } from '@/constants/typography';
import { useCoreData, useProjectActions } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { parsePendingInvites, pendingInviteHeadline, type PendingInvite } from '@/utils/deepLinksInvite';
import { settleWithin } from '@/utils/projectRole';
import { showAlert } from '@/utils/alert';
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

// Motion (slick-3): the copy, then each card, 50 ms apart, 220 ms fades — the
// cards are in within about half a second.
const STAGGER_MS = 50; // hoist into Motion.duration after round 3
const ENTER_MS = 220; // hoist into Motion.duration after round 3
const CARD_RISE = 12;
const PRESS_SCALE = 0.98;

/**
 * The pick's two hold points. commitRole calls `ready` once everything BEFORE
 * its first completeOnboarding() / router call has run (the role write, the
 * analytics, the invite lookup); `ready` reports success and then waits until
 * the overlay has faded and unmounted. Its catch calls `failed`, which reports
 * the failure and waits the same way. So nothing navigates while the overlay
 * is up, and nothing is left waiting after it.
 */
type PickGate = { ready: () => Promise<void>; failed: () => Promise<void> };
/** One pick in flight: `prepared` never rejects (true = ready, false = failed). */
type PickRun = { prepared: Promise<boolean>; settled: boolean; release: () => void };

export default function PersonaSelectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { hasSeenOnboarding } = useCoreData();
  const { setUserRole, completeOnboarding } = useProjectActions();
  // #93 / #156: set by accept-invite when a brand-new account has just joined
  // someone else's project. He still picks his persona (a foreman and a
  // homeowner get different homes), but the GC's own onboarding — company
  // name, rates, "price your first bid" — is not his, so it is skipped and
  // this screen opens the job. Only an id-shaped value is honoured; it goes
  // into a route.
  const rawInvited = useLocalSearchParams<{ invitedProject?: string }>().invitedProject;
  const invitedProject = typeof rawInvited === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(rawInvited) ? rawInvited : null;

  const { isDesktop } = useResponsiveLayout();

  // #107 / #131 safety net: an invite that reached neither the URL nor the
  // account (a link opened on another device, an OAuth sign-up in a different
  // browser, a pasted address). For a NEW account with no invitedProject, ask
  // the server which invites wait for his verified email — the same
  // project-invite `listPending` call, and the same react-query entry, as
  // Home's PendingInvitesCard. If one does, the GC onboarding is not his:
  // contractor / both skip it and land on Home, where that card offers the
  // invite with one tap. Nothing is accepted on his behalf.
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const lookForInvites = !invitedProject && hasSeenOnboarding === false && !!userId && isSupabaseConfigured;
  const pendingInvitesQueryKey = useMemo(() => ['pending-invites', userId] as const, [userId]);
  const fetchPendingInvites = useCallback(async (): Promise<PendingInvite[]> => {
    const { data, error } = await supabase.functions.invoke('project-invite', { body: { action: 'listPending' } });
    if (error) throw error;
    return parsePendingInvites(data);
  }, []);
  const pendingInvitesQuery = useQuery({
    // A react-query key (memory only), not a storage key — shared with
    // components/collaborators/PendingInvitesCard.
    queryKey: pendingInvitesQueryKey,
    enabled: lookForInvites,
    staleTime: 60_000,
    queryFn: fetchPendingInvites,
  });
  const waitingInvite: PendingInvite | null = lookForInvites ? (pendingInvitesQuery.data?.[0] ?? null) : null;

  const [submitting, setSubmitting] = useState<UserRole | null>(null);

  // ── Persona-switch overlay ─────────────────────────────────────────────────
  // showOverlay drives the full-screen circular reveal animation.
  // pendingRole / pendingOrigin store the selection until onDone fires.
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayRole, setOverlayRole] = useState<UserRole>('contractor');
  const [overlayOrigin, setOverlayOrigin] = useState<{ x: number; y: number } | undefined>();
  const [overlayRect, setOverlayRect] = useState<{ x: number; y: number; width: number; height: number } | undefined>();
  // One ref per role card for measureInWindow origin capture
  const cardRefs = useRef<Record<UserRole, View | null>>({
    contractor: null,
    client: null,
    both: null,
    property_manager: null,
  });
  // The pick in flight (see PickRun), or null.
  const pickRef = useRef<PickRun | null>(null);

  // Reduce Motion, from the app's one motion store (iOS setting / the web's
  // prefers-reduced-motion). The overlay gets it too.
  const reduceMotion = useReducedMotion();

  // Staggered reveal — the copy, then each card on its own opacity + rise, so
  // the four arrive one by one rather than as a slab.
  const eyebrowOpacity = useRef(new Animated.Value(0)).current;
  const headlineOpacity = useRef(new Animated.Value(0)).current;
  const bodyOpacity = useRef(new Animated.Value(0)).current;
  const trustOpacity = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(8)).current;
  const cardOpacity = useRef(ROLES.map(() => new Animated.Value(0))).current;
  const cardLift = useRef(ROLES.map(() => new Animated.Value(CARD_RISE))).current;
  const cardPress = useRef(ROLES.map(() => new Animated.Value(1))).current;
  // Set while the overlay's opaque scrim covers a successful pick: the copy and
  // cards are hidden under it, and the entrance must not bring them back.
  const listHiddenRef = useRef(false);

  useEffect(() => {
    if (listHiddenRef.current) return;
    if (reduceMotion) {
      Animated.parallel([
        Animated.timing(eyebrowOpacity, { toValue: 1, duration: 200, useNativeDriver: nativeDriver }),
        Animated.timing(headlineOpacity, { toValue: 1, duration: 200, useNativeDriver: nativeDriver }),
        Animated.timing(bodyOpacity, { toValue: 1, duration: 200, useNativeDriver: nativeDriver }),
        ...cardOpacity.map((v) => Animated.timing(v, { toValue: 1, duration: 200, useNativeDriver: nativeDriver })),
        Animated.timing(trustOpacity, { toValue: 1, duration: 200, useNativeDriver: nativeDriver }),
      ]).start();
      lift.setValue(0);
      cardLift.forEach((v) => v.setValue(0));
      return;
    }
    const fadeIn = (v: Animated.Value) => Animated.timing(v, {
      toValue: 1, duration: ENTER_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
    });
    Animated.parallel([
      Animated.spring(lift, { toValue: 0, ...Motion.spring.rise, useNativeDriver: nativeDriver }),
      Animated.stagger(STAGGER_MS, [
        fadeIn(eyebrowOpacity),
        fadeIn(headlineOpacity),
        fadeIn(bodyOpacity),
        ...ROLES.map((_, i) => Animated.parallel([
          fadeIn(cardOpacity[i]),
          Animated.spring(cardLift[i], { toValue: 0, ...Motion.spring.rise, useNativeDriver: nativeDriver }),
        ])),
        fadeIn(trustOpacity),
      ]),
    ]).start();
  }, [reduceMotion, eyebrowOpacity, headlineOpacity, bodyOpacity, trustOpacity, lift, cardOpacity, cardLift]);

  // Everything that paints this screen's copy and cards (not the wordmark,
  // which onboarding draws in the same place).
  const listOpacities = useCallback(
    () => [eyebrowOpacity, headlineOpacity, bodyOpacity, trustOpacity, ...cardOpacity],
    [eyebrowOpacity, headlineOpacity, bodyOpacity, trustOpacity, cardOpacity],
  );
  // Under the overlay's opaque scrim (t.bg at opacity 1) this is invisible;
  // what the overlay's fade then reveals is the bare ink BrandBackdrop field —
  // the field onboarding opens on. The persona list never comes back.
  const hideListUnderOverlay = useCallback(() => {
    listHiddenRef.current = true;
    listOpacities().forEach((v) => v.setValue(0));
  }, [listOpacities]);
  const restoreList = useCallback(() => {
    listHiddenRef.current = false;
    listOpacities().forEach((v) => v.setValue(1));
    lift.setValue(0);
    cardLift.forEach((v) => v.setValue(0));
  }, [listOpacities, lift, cardLift]);

  const pressCard = useCallback((i: number, to: number) => {
    if (reduceMotion) return;
    Animated.spring(cardPress[i], { toValue: to, ...Motion.spring.snap, useNativeDriver: nativeDriver }).start();
  }, [reduceMotion, cardPress]);

  // commitRole — the role write and the routing. It STARTS the moment he taps
  // (handlePick), so the write happens while the overlay plays, and it HOLDS at
  // gate.ready() — after everything that prepares the pick and before the
  // first completeOnboarding() / router call — until the overlay has faded and
  // unmounted (handleOverlayDone). Every ordering and branch is today's.
  const commitRole = useCallback(async (role: UserRole, gate: PickGate) => {
    try {
      if (invitedProject) {
        // Exactly one navigation: TAKE accept-invite's stashed link before any
        // gate flag flips, so the root layout's replay finds nothing and only
        // the push below opens the job.
        await takePendingDeepLink();
        await setUserRole(role);
        track(AnalyticsEvents.PERSONA_SELECTED, { persona: role, onboarding: !hasSeenOnboarding, invited: true });
        await gate.ready();
        if (!hasSeenOnboarding) await completeOnboarding();
        router.replace('/(tabs)/(home)' as never);
        router.push({ pathname: '/project-detail', params: { id: invitedProject } } as never);
        return;
      }
      await setUserRole(role);
      track(AnalyticsEvents.PERSONA_SELECTED, { persona: role, onboarding: !hasSeenOnboarding });

      // #107 / #131: a new account with an invite waiting skips the GC
      // onboarding. If he tapped before the lookup answered, wait for it
      // briefly (bounded — a dead signal must not hold the pick); no answer
      // means no invite we can show, and first-run proceeds as usual.
      let invited = waitingInvite;
      if (!invited && lookForInvites && !hasSeenOnboarding && (role === 'contractor' || role === 'both')) {
        let found: PendingInvite[] = [];
        await settleWithin(
          queryClient.fetchQuery({ queryKey: pendingInvitesQueryKey, queryFn: fetchPendingInvites, staleTime: 60_000 })
            .then((list) => { found = list; }),
          4000,
        );
        invited = found[0] ?? null;
      }
      // THE HOLD: prepared; nothing navigates until the overlay is gone.
      await gate.ready();
      if (invited && !hasSeenOnboarding) {
        await completeOnboarding();
        router.replace('/(tabs)/(home)' as never);
        return;
      }

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
      // Nothing has navigated (completeOnboarding is the only await ahead of
      // the router calls), so this screen is still mounted. Wait for the
      // overlay to go, then bring the list back for a second tap.
      await gate.failed();
      restoreList();
      console.warn('[persona-select] failed to set role:', err);
      setSubmitting(null);
      // showAlert renders on web too — the new-user flow must never
      // silent-fail on first tap.
      showAlert(
        "Couldn't save your choice",
        'Please tap your role again.',
      );
    }
  }, [hasSeenOnboarding, router, setUserRole, completeOnboarding, invitedProject, waitingInvite, lookForInvites, queryClient, fetchPendingInvites, pendingInvitesQueryKey, restoreList]);

  const handlePick = useCallback((role: UserRole) => {
    if (submitting) return;
    setSubmitting(role);

    // The pick's hold points (PickRun). `prepared` never rejects, and
    // commitRole catches everything, so no bare rejecting promise exists.
    let markPrepared: (ok: boolean) => void = () => {};
    let release: () => void = () => {};
    const overlayGone = new Promise<void>((resolve) => { release = resolve; });
    const run: PickRun = { prepared: Promise.resolve(false), settled: false, release: () => release() };
    run.prepared = new Promise<boolean>((resolve) => {
      markPrepared = (ok) => {
        if (run.settled) return;
        run.settled = true;
        resolve(ok);
      };
    });
    pickRef.current = run;

    // The role write starts NOW, while the overlay plays — no dead time after it.
    void commitRole(role, {
      ready: async () => { markPrepared(true); await overlayGone; },
      failed: async () => { markPrepared(false); await overlayGone; },
    });

    // Measure the tapped card: the overlay's card lifts out of this rect.
    const ref = cardRefs.current[role];
    if (ref && typeof ref.measureInWindow === 'function') {
      ref.measureInWindow((cx, cy, cw, ch) => {
        setOverlayOrigin({ x: cx + cw / 2, y: cy + ch / 2 });
        setOverlayRect(cw > 0 && ch > 0 ? { x: cx, y: cy, width: cw, height: ch } : undefined);
        setOverlayRole(role);
        setShowOverlay(true);
      });
    } else {
      setOverlayRect(undefined);
      setOverlayRole(role);
      setShowOverlay(true);
    }
  }, [submitting, commitRole]);

  // The overlay's HOLD point (onSettled): wait for the pick to be prepared and,
  // on success, hide the list under the scrim. Never navigates.
  const handleOverlaySettled = useCallback(async () => {
    const run = pickRef.current;
    if (!run) return;
    const ok = await run.prepared;
    // Past the overlay's cap the overlay may already be gone: hide nothing then.
    if (ok && pickRef.current === run) hideListUnderOverlay();
  }, [hideListUnderOverlay]);

  // Called once the overlay has faded and unmounted — only now may the pick
  // navigate (commitRole continues past gate.ready()).
  const handleOverlayDone = useCallback(() => {
    setShowOverlay(false);
    const run = pickRef.current;
    if (!run) return;
    pickRef.current = null;
    // Past the 5 s cap the write may still be in flight: show the list (the
    // tapped card keeps its busy state) while it finishes; navigation follows.
    if (!run.settled) restoreList();
    run.release();
  }, [restoreList]);

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
          {invitedProject
            ? "You've joined a project. Tell us which side you're on and we'll open it — you can switch later in Settings."
            : waitingInvite
            ? `${pendingInviteHeadline(waitingInvite)}. Tell us which side you're on and it will be waiting on your Home screen to accept — you can switch later in Settings.`
            : "MAGE ID has two sides — the operating system for builders, and a marketplace for property owners hiring them. Pick one and we'll set up the right experience. You can switch later in Settings."}
        </Animated.Text>

        <View style={[styles.cardList, isDesktop && styles.cardGrid]}>
          {ROLES.map((role, i) => {
            const Icon = ROLE_ICONS[role];
            const isSubmitting = submitting === role;
            return (
              <Animated.View
                key={role}
                ref={(r: View | null) => { cardRefs.current[role] = r; }}
                collapsable={false}
                style={{ opacity: cardOpacity[i], transform: [{ translateY: cardLift[i] }, { scale: cardPress[i] }] }}
              >
                <Pressable
                  onPress={() => handlePick(role)}
                  onPressIn={() => pressCard(i, PRESS_SCALE)}
                  onPressOut={() => pressCard(i, 1)}
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
              </Animated.View>
            );
          })}
        </View>

        <Animated.Text style={[styles.trustLine, { opacity: trustOpacity }]}>
          You can change this anytime in Settings
        </Animated.Text>
      </Animated.View>

      {/* Circular reveal transition when the user picks a new persona */}
      <PersonaSwitchOverlay
        visible={showOverlay}
        toRole={overlayRole}
        originPoint={overlayOrigin}
        originRect={overlayRect}
        reduceMotion={reduceMotion}
        onSettled={handleOverlaySettled}
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
