// EmptyState — premium empty-state primitive used everywhere a list
// has no items yet. Replaces "No projects yet"-style flat text with
// a centered icon + soft halo, generous typography, and an optional
// CTA. The whole thing fades + slides up on mount so it feels alive.
//
// NO structural lines behind the content. This primitive used to paint a
// decorative "blueprint" grid (2 horizontal + 2 vertical hairlines) behind the
// icon and copy. On a real screen it did not read as graph paper — it read as
// a chart/Gantt grid bleeding through from underneath, i.e. as a rendering
// bug, and it did so on EVERY empty state in the app because every one of them
// routes through this component. It is gone and must stay gone: an empty state
// is the one moment the app has nothing to show, so it has to look deliberate
// rather than broken. Pinned by scripts/validate-visual-regressions.ts.
//
// Same props as the previous version (icon, title, message, action) —
// drop-in upgrade with no call-site changes.
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Optional secondary subtle action ("Learn more" style). */
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
  /** Override the icon halo color. Defaults to brand primary tint. */
  accent?: string;
  /** Optional 1-3 numbered steps shown between message and CTA — gives the
   *  user a concrete "do this, then this" path so the empty screen teaches
   *  rather than scolds. Each entry is a single short sentence. */
  steps?: string[];
}

export default function EmptyState({
  icon, title, message, actionLabel, onAction,
  secondaryLabel, onSecondaryAction, accent, steps,
}: EmptyStateProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const enter = useRef(new Animated.Value(0)).current;
  // Icon-halo gentle pulse so the screen doesn't feel static.
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();
  }, [enter, pulse]);

  const translate = enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });

  const accentColor = accent ?? colors.accent;
  // The CTA carries WHITE text, so its fill must clear 4.5:1 for white — the
  // brand #FF6A1A only reaches 2.87:1. accentFill (#BC440C, white 5.29:1) is
  // that accessible fill. The halo/icon/step chrome keep accentColor (large
  // non-text, 3:1) so the brand hue still reads on the empty state.
  const buttonFill = colors.accentFill;

  const handlePrimary = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onAction?.();
  };
  const handleSecondary = () => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    onSecondaryAction?.();
  };

  return (
    <Animated.View
      style={[styles.container, { opacity: enter, transform: [{ translateY: translate }] }]}
      testID="empty-state"
    >
      <View style={styles.iconStack}>
        <Animated.View
          style={[
            styles.halo,
            {
              backgroundColor: accentColor + '14',
              opacity: haloOpacity,
              transform: [{ scale: haloScale }],
            },
          ]}
        />
        <View style={[styles.iconContainer, { backgroundColor: accentColor + '18' }]}>
          {icon}
        </View>
      </View>

      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>

      {steps && steps.length > 0 && (
        <View style={styles.steps}>
          {steps.map((step, idx) => (
            <View key={idx} style={styles.stepRow}>
              <View style={[styles.stepBullet, { backgroundColor: accentColor + '22', borderColor: accentColor + '55' }]}>
                <Text style={[styles.stepBulletText, { color: accentColor }]}>{idx + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
      )}

      {actionLabel && onAction && (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: buttonFill, shadowColor: buttonFill }]}
          onPress={handlePrimary}
          activeOpacity={0.85}
        >
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}

      {secondaryLabel && onSecondaryAction && (
        <TouchableOpacity onPress={handleSecondary} style={styles.secondaryButton} activeOpacity={0.7}>
          <Text style={styles.secondaryText}>{secondaryLabel}</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  iconStack: {
    width: 96,
    height: 96,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 24,
  },
  halo: {
    position: 'absolute' as const,
    width: 96,
    height: 96,
    borderRadius: 28,
  },
  iconContainer: {
    width: 76,
    height: 76,
    borderRadius: 22,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  title: {
    ...Type.serifHeadline,
    color: t.text,
    textAlign: 'center' as const,
    marginBottom: 10,
  },
  message: {
    fontSize: Type.subhead.fontSize,
    color: t.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 22,
    marginBottom: 28,
    maxWidth: 320,
  },
  steps: {
    alignSelf: 'stretch' as const,
    maxWidth: 360,
    width: '100%' as const,
    gap: 10,
    marginTop: -8,
    marginBottom: 24,
  },
  stepRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
  },
  stepBullet: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    marginTop: 1,
    flexShrink: 0,
  },
  stepBulletText: {
    fontSize: 11,
    fontWeight: '800' as const,
  },
  stepText: {
    flex: 1,
    fontSize: Type.bodyCompact.fontSize,
    color: t.textSecondary,
    lineHeight: 20,
  },
  button: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: Tokens.radius.lg,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 3,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  secondaryButton: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  secondaryText: {
    color: t.textSecondary,
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
  },
});
