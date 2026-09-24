// components/tutorial/SuccessStamp.tsx — the "you did the real thing" moment.
//
// Shown only in the machine's 'celebrate' phase, which is only entered on the
// app's REAL success signal (the report saved, the item logged, the invoice
// sent). A failed save emits nothing, so there is never a stamp for a save
// that did not happen.
//
//   • the screen dims to 35 %;
//   • a 64 px success disc with a check scales in (280 ms, back-out);
//   • the title, and ONE specific subline built from the real payload
//     ('Kitchen · Electrical · pinned on A-101');
//   • a 14-piece sawdust burst (600 ms, native driver);
//   • a success haptic on native.
// The host advances after 1.4 s; a tap advances at once.
//
// Why not the app's ConfettiHost: it no-ops on web and still carries the old
// orange palette. This draws in whichever tutorial layer is on top, so it
// shows inside the plan-pin modal too.
//
// Reduce Motion: a static check, no scale, no burst — the haptic stays.

import React, { useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/contexts/ThemeContext';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { labelOn } from '@/components/ui/ink';

const PIECES = 14;

export interface SuccessStampProps {
  title: string;
  sub: string;
  reduceMotion: boolean;
  onDone: () => void;
}

export function SuccessStamp({ title, sub, reduceMotion, onDone }: SuccessStampProps) {
  const { colors } = useTheme();
  const dim = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(reduceMotion ? 1 : 0.4)).current;
  const disc = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const burst = useRef(new Animated.Value(0)).current;

  const pieces = useMemo(() => {
    const palette = [colors.accentFill, colors.success, colors.text, colors.surfaceAlt];
    return Array.from({ length: PIECES }, (_, i) => {
      const angle = (i / PIECES) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1);
      const dist = 58 + (i % 3) * 14;
      return {
        key: i,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist,
        rotate: `${(i * 47) % 180}deg`,
        color: palette[i % palette.length],
        w: i % 2 ? 4 : 6,
        h: i % 2 ? 9 : 5,
      };
    });
  }, [colors.accentFill, colors.success, colors.text, colors.surfaceAlt]);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    AccessibilityInfo.announceForAccessibility(`${title}. ${sub}`);
    const fadeDim = Animated.timing(dim, { toValue: 1, duration: 160, useNativeDriver: true });
    if (reduceMotion) {
      fadeDim.start();
      return () => fadeDim.stop();
    }
    const anim = Animated.parallel([
      fadeDim,
      Animated.timing(disc, { toValue: 1, duration: 120, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 280, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(120),
        Animated.timing(burst, { toValue: 1, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    ]);
    anim.start();
    return () => anim.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- plays once per stamp

  const onLight = labelOn(colors.success);

  return (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={onDone}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}. Continue`}
      testID="tutorial-success-stamp"
    >
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: Colors.overlay, opacity: dim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] }) }]}
      />
      <View pointerEvents="none" style={styles.center}>
        <View style={styles.burstOrigin}>
          {!reduceMotion &&
            pieces.map(p => (
              <Animated.View
                key={p.key}
                style={[
                  styles.piece,
                  {
                    width: p.w,
                    height: p.h,
                    backgroundColor: p.color,
                    opacity: burst.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 1, 0] }),
                    transform: [
                      { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] }) },
                      { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, p.dy] }) },
                      { rotate: p.rotate },
                    ],
                  },
                ]}
              />
            ))}
          <Animated.View style={[styles.disc, { backgroundColor: colors.success, opacity: disc, transform: [{ scale }] }]}>
            <Check size={34} strokeWidth={3} color={onLight} />
          </Animated.View>
        </View>
        <View style={[styles.card, Tokens.shadow.heavy, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <Text style={[Type.serifHeadline, { color: colors.text, textAlign: 'center' }]} numberOfLines={2}>
            {title}
          </Text>
          {sub ? (
            <Text style={[Type.footnote, { color: colors.textSecondary, textAlign: 'center', marginTop: 4 }]} numberOfLines={3}>
              {sub}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  burstOrigin: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  // Sawdust: plain rotated rects, square-cornered like the real thing.
  piece: { position: 'absolute' },
  disc: { width: 64, height: 64, borderRadius: Tokens.radius.full, alignItems: 'center', justifyContent: 'center' },
  card: {
    maxWidth: 360,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    alignItems: 'center',
  },
});

export default SuccessStamp;
