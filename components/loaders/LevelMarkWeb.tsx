// LevelMarkWeb — the web level. THIS IS A STATIC STUB (lane CORE): the same
// geometry as the native mark (levelParts), bubble centred, no keyframes and
// no JS loop. The WEB lane replaces the body with CSS motion and keeps the
// props (LevelMarkProps from ./LevelMark).
//
// It still honours the gate contract: `done` false→true calls onSettled after
// 140 ms, so <Loading>, ScreenLoader and the hooks finish on the web too.
// Theme read null-safely (BrandSplash renders outside ThemeProvider).

import React, { useEffect, useRef } from 'react';
import { PixelRatio, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { levelParts, type LevelRect } from '@/utils/levelTimeline';
import { levelPalette, splashFallbackColors } from './themeFallback';
import type { LevelMarkProps } from './LevelMark';

const WEB_SETTLE_MS = 140;
const snap = (v: number) => PixelRatio.roundToNearestPixel(v);

function rect(r: LevelRect, bg: string, opacity?: number): ViewStyle {
  return {
    position: 'absolute',
    left: snap(r.left),
    top: snap(r.top),
    width: Math.max(1, snap(r.width)),
    height: Math.max(1, snap(r.height)),
    borderRadius: snap(r.radius),
    backgroundColor: bg,
    ...(opacity != null && opacity !== 1 ? { opacity } : null),
  };
}

export default function LevelMarkWeb({
  size,
  tone = 'accent',
  color,
  done = false,
  exit,
  onSettled,
  testID = 'level-mark',
}: LevelMarkProps) {
  const theme = useTheme() as ReturnType<typeof useTheme> | undefined;
  const splash = tone === 'splash';
  const colors = splash ? null : theme?.colors ?? splashFallbackColors();
  const pal = levelPalette(tone, color, colors);
  const parts = levelParts(size, tone);

  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  useEffect(() => {
    if (!done || exit === 'none') return;
    const id = setTimeout(() => onSettledRef.current?.(), WEB_SETTLE_MS);
    return () => clearTimeout(id);
  }, [done, exit]);

  return (
    <View
      testID={testID}
      style={{ width: snap(parts.boxW), height: snap(parts.boxH) }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      {parts.capL && <View style={rect(parts.capL, pal.cap, parts.capOpacity)} />}
      {parts.capR && <View style={rect(parts.capR, pal.cap, parts.capOpacity)} />}
      <View testID={`${testID}-track`} style={rect(parts.track, pal.track, parts.trackOpacity)} />
      {parts.grads?.map((g, i) => <View key={i} style={rect(g, pal.grad, parts.gradOpacity)} />)}
      <View testID={`${testID}-bubble`} style={rect(parts.bubble, pal.bubble)} />
    </View>
  );
}
