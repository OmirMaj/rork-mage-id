// components/brain/BrainFab.tsx
//
// The single global entry to the MAGE ID Brain. One floating action button,
// mounted once in app/_layout.tsx, present on every screen. Tapping it opens
// the conversational ask screen (app/ask.tsx) — the front door to the Brain.
// Search still exists but is reached from a search icon inside that screen.
// This FAB replaces the scattered AI doors — the two home cards, the
// HomeFabStack, and the per-screen AICopilot FABs.
//
// Geometry mirrors the old AICopilot FAB (56pt circle, bottom-right, lifted
// above the tab bar) so it lands where users already reach for it.
//
// Look & motion: a warm two-tone gradient (accentHot → accent) on the app's
// neutral floating elevation (Shadow.medium — the accent glow and the idle
// "breathing" pulse were retired in the smoothness pass: no glows, nothing that
// moves on its own), a critically-damped spring on press that matches the app's
// Button physics, a spring on hide/show, and a glide (not a one-frame jump)
// when a screen's sticky footer lifts it. All on the native driver
// (transform/opacity), no new dependency.
//
// Desktop web (wave 6d restore, d6r lane K1): the tap opens Ask in the shell's
// right DOCK beside the page (hooks/useAskDock) instead of a full-window page,
// and the FAB steps aside while that dock is on screen — it would otherwise
// float over the conversation it opened. Where the dock cannot show (a
// shell-exempt route) the FAB stays, and its tap reaches Ask through
// useAskDock's page fallback. Cmd+P leaves it off the paper (data-print).
// The phone path — the router.push below — is unchanged.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Platform, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments, useRouter, useGlobalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/contexts/ThemeContext';
import { Tokens, Motion, Shadow } from '@/constants/designTokens';
import { nativeDriver, reducedMotion } from '@/components/ui';
import { MageAIMark } from '@/components/icons';
import { useBrainFabPresentation, resetBrainFabScroll } from '@/components/brain/brainFabState';
import { useTutorialCoachVisible } from '@/utils/tutorial/store';
import { anchorProjectIdFor } from '@/utils/resolveStarters';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import { useShellDock } from '@/components/desktop/ShellDock';
import { useAskDock } from '@/hooks/useAskDock';
import { useSearch } from '@/contexts/SearchContext';

// Routes where the Brain must NOT appear: tokenized public viewers handed to
// clients/subs (they have no account and must see only what's shared), the
// pre-auth / onboarding flow, and the ask screen itself (the FAB opens it, so
// it must not float on top of its own destination).
const HIDDEN_ROOTS: ReadonlySet<string> = new Set([
  'shared-estimate', 'shared-photos', 'shared-schedule', 'shared-plan', 'client-view',
  'prequal-form', 'claim-crew', 'ask',
  'login', 'signup', 'reset-password', 'onboarding', 'persona-select', 'onboarding-paywall',
]);

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function BrainFab() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const globalParams = useGlobalSearchParams();

  // Scroll-away + per-screen suppression / lift. See brainFabState for why the
  // FAB owns this rather than every screen padding around it (audit defect #5).
  const { hidden: fabStateHidden, lift } = useBrainFabPresentation();
  // Desktop web: the FAB opens the Ask dock and hides while a dock is showing.
  const isDesktopWeb = useIsDesktopWeb();
  const dock = useShellDock();
  const { openAsk } = useAskDock();
  // Undefined outside SearchProvider (a jest mount of the FAB alone).
  const search = useSearch() as ReturnType<typeof useSearch> | undefined;
  const openVoice = search?.openVoice;
  // A tutorial coach (spotlight, card, stamp or finale) is on screen: hide.
  // In card mode there are no dims over the FAB, and a tap on it opened /ask
  // mid-step, pausing the run (spec §16).
  const coachUp = useTutorialCoachVisible();
  const hidden = fabStateHidden || coachUp;

  // A screen that scrolled the FAB away stays mounted under whatever is pushed
  // on top of it, so its own cleanup never runs. Reset on every route change.
  const routeKey = segments.join('/');
  useEffect(() => { resetBrainFabScroll(); }, [routeKey]);

  // hide/show (opacity + slide + shrink) and press (spring). `breathe` is a
  // static 1 now — the idle pulse is gone (it also re-rendered every web page
  // on every frame, forever) — kept so the transform structure is unchanged.
  const anim = useRef(new Animated.Value(1)).current;
  const breathe = useRef(new Animated.Value(1)).current;
  const press = useRef(new Animated.Value(1)).current;
  // The button scales by breathe × press together; the wrapper owns hide/show.
  const pulseScale = useMemo(() => Animated.multiply(breathe, press), [breathe, press]);

  useEffect(() => {
    const toValue = hidden ? 0 : 1;
    if (reducedMotion()) { anim.setValue(toValue); return; }
    Animated.spring(anim, { toValue, ...Motion.spring.rise, useNativeDriver: nativeDriver }).start();
  }, [hidden, anim]);

  // A screen registering a sticky footer raises `lift`, and `bottom` below
  // takes the new resting place in one frame. To glide instead, the offset is
  // taken up by a translateY the same frame (so nothing visibly moves yet) and
  // then springs to 0. It rests at 0, so a still screen is unchanged.
  // A lift that changes again mid-glide (estimate/full: 16, then the cart
  // bar's measured height a frame later) adds to the offset still in flight
  // rather than replacing it, so the FAB never jumps. `liftNow` follows the
  // value through a listener (native-driven values report each frame to it).
  const liftOffset = useRef(new Animated.Value(0)).current;
  const liftNow = useRef(0);
  useEffect(() => {
    const id = liftOffset.addListener(({ value }) => { liftNow.current = value; });
    return () => liftOffset.removeListener(id);
  }, [liftOffset]);
  const prevLift = useRef(lift);
  useLayoutEffect(() => {
    const delta = lift - prevLift.current;
    prevLift.current = lift;
    if (delta === 0 || reducedMotion()) return;
    liftOffset.stopAnimation();
    liftOffset.setValue(liftNow.current + delta);
    Animated.spring(liftOffset, { toValue: 0, ...Motion.spring.rise, useNativeDriver: nativeDriver }).start();
  }, [lift, liftOffset]);

  const onPressIn = useCallback(() => {
    if (reducedMotion()) return;
    Animated.spring(press, { toValue: 0.94, ...Motion.spring.snap, useNativeDriver: nativeDriver }).start();
  }, [press]);
  const onPressOut = useCallback(() => {
    if (reducedMotion()) { press.setValue(1); return; }
    Animated.spring(press, { toValue: 1, ...Motion.spring.snap, useNativeDriver: nativeDriver }).start();
  }, [press]);
  const handlePress = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Open the ask screen directly — the conversational surface is the front
    // door to the Brain now. Search moved to a search icon inside that screen.
    // Pass the innermost route name so Ask can offer screen-aware starters.
    const cleaned = segments.map(s => s.replace(/[()]/g, '')).filter(Boolean);
    const screen = cleaned[cleaned.length - 1];
    // And the job on screen, so Ask answers for Henderson on Henderson's page
    // instead of the whole business (audit #36). anchorProjectIdFor forwards
    // only from the job screens — a bare `id` elsewhere is some other record.
    const projectId = anchorProjectIdFor(screen, globalParams);
    if (isDesktopWeb) { openAsk({ screen, projectId: projectId ?? undefined }); return; }
    router.push(
      screen
        ? { pathname: '/ask', params: projectId ? { screen, projectId } : { screen } }
        : '/ask',
    );
  }, [router, segments, globalParams, isDesktopWeb, openAsk]);
  // UX A3: hold the button to start a voice note, already recording, on the
  // project the screen is on (the mic resolves it). Phone only — the web mic
  // records nothing, so the web keeps just the tap.
  const handleLongPress = useCallback(() => {
    if (Platform.OS === 'web' || !openVoice) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    openVoice({ autoStart: true });
  }, [openVoice]);
  const canHoldForVoice = Platform.OS !== 'web' && !!openVoice;

  // Hide on public/tokenized viewers and the pre-auth flow.
  if (HIDDEN_ROOTS.has((segments[0] as string) ?? '')) return null;
  // A docked panel (Ask, the attention list) is on screen at the bottom-right
  // where the FAB floats. `showing`, not "something is docked": on a
  // shell-exempt route the dock is not drawn and the FAB is the way back.
  if (isDesktopWeb && dock.showing) return null;

  return (
    <Animated.View
      // Never hit-test while it's hidden — otherwise an invisible circle keeps
      // swallowing taps meant for the content it used to be covering.
      pointerEvents={hidden ? 'none' : 'auto'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      // Cmd+P: chrome, not the page. Desktop web only — below 900 px the
      // print CSS's [data-testid='brain-fab'] rule already keeps it off paper,
      // and the phone tree stays exactly as it was.
      {...(isDesktopWeb ? ({ dataSet: { print: 'hide' } } as object) : null)}
      style={[
        styles.fabWrap,
        {
          bottom: insets.bottom + 70 + lift + (Platform.OS === 'web' ? 48 : 0),
          opacity: anim,
          transform: [
            { translateY: Animated.add(anim.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }), liftOffset) },
            { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
          ],
        },
      ]}
    >
      <AnimatedPressable
        onPress={handlePress}
        onLongPress={canHoldForVoice ? handleLongPress : undefined}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityLabel="Ask MAGE"
        accessibilityHint={canHoldForVoice ? 'Hold to record a voice note' : undefined}
        testID="brain-fab"
        style={[styles.fab, { transform: [{ scale: pulseScale }] }]}
      >
        <LinearGradient
          // Bright warm orange (top-left) → deep burnt orange (bottom-right): a
          // real, visible gradient with depth, not a near-flat one, so the mark
          // reads as premium rather than a plain disc.
          colors={[colors.accentHot, colors.accentFill]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <MageAIMark size={26} color="#FFFFFF" accentColor="#FFFFFF" />
      </AnimatedPressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Positioning + the neutral floating elevation + hide/lift live on the
  // wrapper. The button (gradient circle) springs inside it.
  fabWrap: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: Tokens.radius.full,
    // The app's neutral lift, not an accent-coloured glow (the founder: "no
    // glows"). Android keeps elevation 12: there it also decides draw order
    // against root-level siblings, and its shadow is the token's black.
    ...Shadow.medium,
    elevation: 12,
    zIndex: 40,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: Tokens.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
