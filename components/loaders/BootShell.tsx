// BootShell — the first-boot loader that sits UNDER BrandSplash: the splash ink
// and the still splash level at the native splash's exact rect.
//
// THIS IS A DELIBERATELY STATIC STUB (lane CORE). The LAUNCH lane owns this
// file in Phase B and adds the post-splash behaviour (coming alive, the
// wordmark) on top of a launch-stage flag BrandSplash publishes. Why static:
// BootShell mounts on the first _layout render, while the native splash is
// still up, and BrandSplash mounts LATER. If BootShell ran its own alive /
// wordmark clock from its own mount, the frames between hideAsync and
// BrandSplash's first paint (and the failsafe hand-back) would show a seeking
// bubble and a wordmark that BrandSplash then snaps back to centre — the exact
// restart the design forbids. A still replica is always correct under the
// native splash and under BrandSplash's frame 0.
//
// The mark still HOLDS the shared clock (animate true, amp pinned 0): when
// BrandSplash unmounts, the clock's ref-count never touches 0, so it never
// stops or resets and the hand-back keeps phase. Under Reduce Motion it is a
// still frame (animate false, no clock). No wordmark, no amp motion, no
// timers, and no useTheme at all (NATIVE_SPLASH_* only), so it is safe outside
// every provider.

import React, { useRef } from 'react';
import { Animated, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useReducedMotion } from '@/components/ui/motion';
import { NATIVE_SPLASH_BG, splashRect } from '@/utils/levelTimeline';
import LevelMark from './LevelMark';

export default function BootShell({ testID = 'boot-shell' }: { testID?: string }) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const ampRef = useRef(new Animated.Value(0)); // never animated in this lane
  const rect = splashRect(width, height, Platform.OS);
  return (
    <View
      testID={testID}
      style={styles.root}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading MAGE ID"
    >
      <View
        testID={`${testID}-mark`}
        style={{ position: 'absolute', left: rect.markLeft, top: rect.markTop, width: rect.markW, height: rect.markH }}
      >
        <LevelMark
          tone="splash"
          size={rect.markW}
          revealDelayMs={0}
          exit="none"
          amp={ampRef.current}
          animate={!reduce}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NATIVE_SPLASH_BG },
});
