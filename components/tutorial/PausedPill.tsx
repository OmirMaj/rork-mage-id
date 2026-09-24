// components/tutorial/PausedPill.tsx — 'Tutorial paused · Resume · End'.
//
// Shown on the SAMPLE's screens only, while the run is paused (he left the
// step's screen, backgrounded the app, or relaunched with a saved run). It is
// the only way back in: nothing ever resumes by itself (spec hard
// constraint). Not on Home — Home is already the most crowded surface.
//
// Resume goes through the host, which first takes him to the step's screen
// when he is elsewhere (machine.resumeTarget) and then dispatches RESUME.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export interface PausedPillProps {
  top: number;
  onResume: () => void;
  onEnd: () => void;
}

export function PausedPill({ top, onResume, onEnd }: PausedPillProps) {
  const { colors } = useTheme();
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top }]}>
      <View
        style={[styles.pill, Tokens.shadow.medium, { backgroundColor: colors.surface, borderColor: colors.line }]}
        testID="tutorial-paused-pill"
      >
        <Text style={[Type.footnoteEmphasized, styles.label, { color: colors.text }]}>Tutorial paused</Text>
        <Text style={[Type.footnote, { color: colors.textMuted }]}>·</Text>
        <Pressable onPress={onResume} accessibilityRole="button" accessibilityLabel="Resume tutorial" hitSlop={6} style={styles.action} testID="tutorial-resume">
          <Text style={[Type.footnoteEmphasized, { color: colors.accentLabel }]}>Resume</Text>
        </Pressable>
        <Text style={[Type.footnote, { color: colors.textMuted }]}>·</Text>
        <Pressable onPress={onEnd} accessibilityRole="button" accessibilityLabel="End tutorial" hitSlop={6} style={styles.action} testID="tutorial-paused-end">
          <Text style={[Type.footnoteEmphasized, { color: colors.textSecondary }]}>End</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 14,
    paddingRight: 6,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    minHeight: Tokens.touchTarget.min,
  },
  label: { marginRight: 2 },
  action: { minHeight: Tokens.touchTarget.min, minWidth: Tokens.touchTarget.min, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
});

export default PausedPill;
