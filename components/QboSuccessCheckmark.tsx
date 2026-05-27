// Animated success checkmark — spring scale on the badge + delayed pop on the
// check glyph + soft expanding ring. Used in the QBO connect-callback success
// state and the qbo-setup poll-lands-on-connected moment to make the
// completion feel earned. Pure RN Animated API (no reanimated dependency).

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';

interface Props {
  size?: number;            // outer circle diameter (default 96)
  color?: string;           // success color (default green)
  ringColor?: string;       // halo ring color (default = color with low alpha)
}

export function QboSuccessCheckmark({ size = 96, color = '#16A34A', ringColor }: Props) {
  // Three orchestrated values: ring expand, badge spring-in, check pop.
  const ringScale = useRef(new Animated.Value(0.2)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;
  const badgeScale = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      // Ring: expands outward + fades out (creates a "burst" effect).
      Animated.sequence([
        Animated.delay(80),
        Animated.parallel([
          Animated.timing(ringScale, {
            toValue: 1.6,
            duration: 700,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(ringOpacity, {
              toValue: 0.35,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.timing(ringOpacity, {
              toValue: 0,
              duration: 500,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]),
      // Badge: spring scales in from zero.
      Animated.sequence([
        Animated.delay(40),
        Animated.spring(badgeScale, {
          toValue: 1,
          tension: 90,
          friction: 8,
          useNativeDriver: true,
        }),
      ]),
      // Check glyph: pops in after the badge has settled.
      Animated.sequence([
        Animated.delay(260),
        Animated.spring(checkScale, {
          toValue: 1,
          tension: 120,
          friction: 7,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [badgeScale, checkScale, ringOpacity, ringScale]);

  const halo = ringColor ?? color + '40'; // 25% alpha

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.ring,
          {
            borderRadius: size / 2,
            backgroundColor: halo,
            opacity: ringOpacity,
            transform: [{ scale: ringScale }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.badge,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            transform: [{ scale: badgeScale }],
          },
        ]}
      >
        <Animated.View style={{ transform: [{ scale: checkScale }] }}>
          <Check size={size * 0.5} color="#FFFFFF" strokeWidth={3.5} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  ring: {
    // populated dynamically
  },
  badge: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
});
