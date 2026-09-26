// ReloadVeil — the sign-in reload cover (slick round 3, lane A1).
//
// While RootLayoutNav reloads the account's data after a sign-in it draws the
// branded loader OVER the mounted Stack (navMode 'stack+overlay', see
// utils/deepLinksInvite.rootNavPresentation). It used to mount a full-screen
// cream CraneLoader for the whole reload, even a 150 ms one, and cut it away:
// a flash. Now:
//   - it blocks input from the first frame, exactly as before;
//   - it only becomes VISIBLE if the reload is still running after
//     VEIL_GRACE_MS, and then fades in;
//   - when the reload ends it stops blocking at once and fades out (skipped if
//     it never became visible), then unmounts.
// Reduce Motion: the grace still applies; it appears and disappears instantly.
// At rest (never active) it renders nothing.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import CraneLoader from '@/components/CraneLoader';
import { nativeDriver, reducedMotion } from '@/components/ui/motion';

// hoist into Motion.duration after round 3
const VEIL_GRACE_MS = 200;
// hoist into Motion.duration after round 3
const VEIL_IN_MS = 160;
// hoist into Motion.duration after round 3
const VEIL_OUT_MS = 180;

export default function ReloadVeil({ active }: { active: boolean }) {
  // mounted: the veil is in the tree (active, or fading out after it).
  const [mounted, setMounted] = useState(active);
  const opacity = useRef(new Animated.Value(0)).current;
  const shownRef = useRef(false);
  const graceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  if (active && !mounted) setMounted(true);

  useEffect(() => {
    const clearGrace = () => {
      if (graceRef.current != null) { clearTimeout(graceRef.current); graceRef.current = null; }
    };
    animRef.current?.stop();
    animRef.current = null;
    if (active) {
      const show = () => {
        graceRef.current = null;
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
    if (!shownRef.current || reducedMotion()) {
      opacity.setValue(0);
      setMounted(false);
      return undefined;
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
    return undefined;
    // `mounted` is read, not a trigger: the effect runs on `active` flips only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, opacity]);

  useEffect(() => () => {
    if (graceRef.current != null) clearTimeout(graceRef.current);
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
        <CraneLoader label="MAGE ID" />
      </Animated.View>
    </View>
  );
}
