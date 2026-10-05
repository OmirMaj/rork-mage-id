// ReloadVeil — the sign-in reload cover (slick round 3, lane A1; the level,
// lane LAUNCH).
//
// While RootLayoutNav reloads the account's data after a sign-in it draws a
// loader OVER the mounted Stack (navMode 'stack+overlay', see
// utils/deepLinksInvite.rootNavPresentation). A data reload is not a brand
// moment, so the picture is the plain ScreenLoader — the theme ground and the
// level at the launch mark's width (screenLevelW), no wordmark (it used to be the "MAGE ID" crane loader). Its
// reveal delay is 0: the veil owns the grace and the fades.
//   - it blocks input from the first frame, exactly as before;
//   - it only becomes VISIBLE if the reload is still running after
//     VEIL_GRACE_MS, and then fades in;
//   - once visible it HOLDS at least VEIL_MIN_MS (the gate's screen minimum),
//     so a reload that ends just after the grace never flashes the level;
//   - when the reload ends it stops blocking at once (only the picture holds)
//     and fades out (skipped if it never became visible), then unmounts.
// Reduce Motion: the grace and the hold still apply; it appears and
// disappears instantly. At rest (never active) it renders nothing.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import ScreenLoader from '@/components/loaders/ScreenLoader';
import { nativeDriver, reducedMotion } from '@/components/ui/motion';
import { LOADER } from '@/utils/levelTimeline';

// hoist into Motion.duration after round 3
const VEIL_GRACE_MS = 200;
// hoist into Motion.duration after round 3
const VEIL_IN_MS = 160;
// hoist into Motion.duration after round 3
const VEIL_OUT_MS = 180;
// Once visible, the picture stays at least this long: the gate's screen minimum (500 ms).
const VEIL_MIN_MS = LOADER.gate.screen.minMs;

export default function ReloadVeil({ active }: { active: boolean }) {
  // mounted: the veil is in the tree (active, or fading out after it).
  const [mounted, setMounted] = useState(active);
  const opacity = useRef(new Animated.Value(0)).current;
  const shownRef = useRef(false);
  const shownAtRef = useRef(0);
  const graceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  if (active && !mounted) setMounted(true);

  useEffect(() => {
    const clearGrace = () => {
      if (graceRef.current != null) { clearTimeout(graceRef.current); graceRef.current = null; }
    };
    // A re-activation during the hold cancels it.
    if (holdRef.current != null) { clearTimeout(holdRef.current); holdRef.current = null; }
    if (active) {
      // Re-activated mid fade-out: stop it (show() brings the veil back to full).
      animRef.current?.stop();
      animRef.current = null;
      const show = () => {
        graceRef.current = null;
        if (!shownRef.current) shownAtRef.current = Date.now();
        shownRef.current = true;
        if (reducedMotion()) { opacity.setValue(1); return; }
        const a = Animated.timing(opacity, {
          toValue: 1, duration: VEIL_IN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
        });
        animRef.current = a;
        a.start();
      };
      // Re-activated mid fade-out: it is still on screen, so no second grace.
      if (shownRef.current) { show(); return clearGrace; }
      opacity.setValue(0);
      graceRef.current = setTimeout(show, VEIL_GRACE_MS);
      return clearGrace;
    }
    clearGrace();
    if (!mounted) return undefined;
    if (!shownRef.current) {
      opacity.setValue(0);
      setMounted(false);
      return undefined;
    }
    // A fade-in still running keeps running through the hold (stopping it here
    // would freeze the picture part-way); the fade-out stops it when it starts.
    const fadeOut = () => {
      holdRef.current = null;
      if (activeRef.current) return;
      animRef.current?.stop();
      animRef.current = null;
      if (reducedMotion()) {
        opacity.setValue(0);
        shownRef.current = false;
        setMounted(false);
        return;
      }
      const a = Animated.timing(opacity, {
        toValue: 0, duration: VEIL_OUT_MS, easing: Easing.in(Easing.cubic), useNativeDriver: nativeDriver,
      });
      animRef.current = a;
      // Unmount on every end (a stopped fade must never leave the veil mounted),
      // unless a new reload re-activated it meanwhile.
      a.start(() => {
        if (activeRef.current) return;
        shownRef.current = false;
        setMounted(false);
      });
    };
    // The fade-out may not START before shownAt + VEIL_MIN_MS.
    const hold = shownAtRef.current + VEIL_MIN_MS - Date.now();
    if (hold > 0) holdRef.current = setTimeout(fadeOut, hold);
    else fadeOut();
    return undefined;
    // `mounted` is read, not a trigger: the effect runs on `active` flips only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, opacity]);

  useEffect(() => () => {
    if (graceRef.current != null) clearTimeout(graceRef.current);
    if (holdRef.current != null) clearTimeout(holdRef.current);
    animRef.current?.stop();
  }, []);

  if (!mounted) return null;
  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}
      testID="root-nav-reload-overlay"
      pointerEvents={active ? 'auto' : 'none'}
    >
      <Animated.View style={{ flex: 1, opacity }}>
        <ScreenLoader revealDelayMs={0} />
      </Animated.View>
    </View>
  );
}
