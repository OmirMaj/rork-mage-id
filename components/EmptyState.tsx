// EmptyState — premium empty-state primitive used everywhere a list
// has no items yet. Replaces "No projects yet"-style flat text with
// a centered icon + soft halo, generous typography, and an optional
// CTA. The whole thing fades + slides up on mount so it feels alive.
//
// Construction-themed touch: a subtle grid pattern behind the icon
// (drawn with two stacked Views — no SVG dep) suggesting graph paper /
// blueprint backing. Stays decorative; doesn't distract.
//
// Same props as the previous version (icon, title, message, action) —
// drop-in upgrade with no call-site changes.
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';

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
}

export default function EmptyState({
  icon, title, message, actionLabel, onAction,
  secondaryLabel, onSecondaryAction, accent,
}: EmptyStateProps) {
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

  const accentColor = accent ?? Colors.primary;

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
      {/* Decorative grid behind the icon — two stacked thin lines suggest
          blueprint paper without needing an image asset. */}
      <View style={styles.gridBackdrop} pointerEvents="none">
        <View style={[styles.gridLine, { top: '30%' as const }]} />
        <View style={[styles.gridLine, { top: '60%' as const }]} />
        <View style={[styles.gridLineV, { left: '30%' as const }]} />
        <View style={[styles.gridLineV, { left: '70%' as const }]} />
      </View>

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

      {actionLabel && onAction && (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: accentColor, shadowColor: accentColor }]}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  gridBackdrop: {
    position: 'absolute' as const,
    top: '20%' as const,
    left: 16,
    right: 16,
    height: 200,
    opacity: 0.5,
  },
  gridLine: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: Colors.borderLight,
  },
  gridLineV: {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: Colors.borderLight,
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
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.text,
    textAlign: 'center' as const,
    marginBottom: 10,
    letterSpacing: -0.4,
  },
  message: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 22,
    marginBottom: 28,
    maxWidth: 320,
  },
  button: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 3,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  secondaryButton: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  secondaryText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: '600' as const,
  },
});
