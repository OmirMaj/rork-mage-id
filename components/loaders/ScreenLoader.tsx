// ScreenLoader — the full-screen loading gate: the theme ground, the level
// centred at the LAUNCH mark's width for this window (utils/levelDesk
// screenLevelW — the one sizing rule; 167 pt on a 390 pt iPhone, where it used
// to be a fixed 64), and an optional caption under it. The replacement for the ~30
// full-screen ActivityIndicator gates (a later codemod wave adopts it) and for
// ReloadVeil's contents (the LAUNCH lane).
//
// `done` plays the level's settle; onSettled fires after it. Theme read
// null-safely (it may render before the ThemeProvider is up).
//
// LAPTOPS AND MONITORS (lane LOADERDESK, utils/levelDesk.ts). On a web window
// 768 px and wider the gate is composed for the wide canvas: the level (the
// table continued past 120, with its graduations and the "it's level" accent
// settle) on a static hairline DATUM that runs to the
// screen gutters, in the theme's textMuted at 0.3. The datum and the caption
// arrive with the level's reveal and leave with its exit (deskFadeStyle). The
// phone — every native platform at any width, and the web below 768 — has no
// datum; every hook runs before that branch.

import React from 'react';
import { Animated, Platform, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { useReducedMotion } from '@/components/ui/motion';
import { DESK_DATUM, DESK_SCREEN, deskGutter, loaderTier, screenLevelW } from '@/utils/levelDesk';
import LevelMark, { useLevelReveal } from './LevelMark';
import { DatumSegment } from './LevelDatum';
import { deskFadeStyle } from './css/deskCss';
import { splashFallbackColors } from './themeFallback';

export interface ScreenLoaderProps {
  caption?: string;
  done?: boolean;
  onSettled?: () => void;
  revealDelayMs?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export default function ScreenLoader({ caption, done = false, onSettled, revealDelayMs = 200, style, testID = 'screen-loader' }: ScreenLoaderProps) {
  const theme = useTheme() as ReturnType<typeof useTheme> | undefined;
  const colors = theme?.colors ?? splashFallbackColors();
  const words = useLevelReveal(revealDelayMs, done, 'settle');
  // The ground stays opaque until `done`, then leaves with the level (so the
  // content arriving underneath is not hidden behind it until unmount).
  const ground = useLevelReveal(0, done, 'settle');
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const tier = loaderTier(width, Platform.OS);
  // The one sizing rule, both branches: as wide as the launch mark.
  const levelW = screenLevelW(width, height, Platform.OS);
  if (tier === 'phone') {
    return (
      <Animated.View
        testID={testID}
        style={[styles.root, { backgroundColor: colors.bg }, style, { opacity: ground }]}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={caption ?? 'Loading'}
        accessibilityState={{ busy: !done }}
      >
        <LevelMark desk size={levelW} revealDelayMs={revealDelayMs} done={done} exit="settle" onSettled={onSettled} />
        {!!caption && (
          <Animated.View style={{ opacity: words }}>
            <Text style={[Type.footnoteEmphasized, styles.caption, { color: colors.textSecondary }]} numberOfLines={2}>
              {caption}
            </Text>
          </Animated.View>
        )}
      </Animated.View>
    );
  }

  // THE DESK (web ≥ 768): the level on a datum, sized for the canvas.
  const S = DESK_SCREEN[tier];
  const fade = deskFadeStyle(revealDelayMs, done, reduce);
  return (
    <Animated.View
      testID={testID}
      style={[styles.deskRoot, { backgroundColor: colors.bg }, style, { opacity: ground }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={caption ?? 'Loading'}
      accessibilityState={{ busy: !done }}
    >
      <View style={[styles.deskRow, { paddingHorizontal: deskGutter(width) }]}>
        <View style={[styles.datumSlot, styles.datumSlotLeft, fade]}>
          <DatumSegment
            side="left" color={colors.textMuted} opacity={DESK_DATUM.themeOpacity}
            style={styles.datumFill} testID={`${testID}-datum-l`}
          />
        </View>
        <LevelMark desk size={levelW} revealDelayMs={revealDelayMs} done={done} exit="settle" onSettled={onSettled} />
        <View style={[styles.datumSlot, styles.datumSlotRight, fade]}>
          <DatumSegment
            side="right" color={colors.textMuted} opacity={DESK_DATUM.themeOpacity}
            style={styles.datumFill} testID={`${testID}-datum-r`}
          />
        </View>
      </View>
      {!!caption && (
        <View style={fade}>
          <Text
            style={[
              S.caption === 'headline' ? Type.headline : Type.footnoteEmphasized,
              styles.deskCaption,
              { marginTop: S.captionGap, maxWidth: S.captionMaxW, color: colors.textSecondary },
            ]}
            numberOfLines={2}
          >
            {caption}
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  caption: { marginTop: 12, letterSpacing: 0.26, textAlign: 'center', maxWidth: 320 },
  // The desk: no 28 px side padding — the datum's gutter is the margin.
  deskRoot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Height = max(the level's box, the 9 px datum); it never changes.
  deskRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  datumSlot: { flex: 1, height: DESK_DATUM.tickH },
  datumSlotLeft: { marginRight: DESK_DATUM.gapPx },
  datumSlotRight: { marginLeft: DESK_DATUM.gapPx },
  datumFill: { flex: 1 },
  deskCaption: { letterSpacing: 0.26, textAlign: 'center' },
});
