// components/auth/AuthGround.tsx — the night ground the auth spine sits on, and its brand pieces.
//
// "Take D" (design-previews/night-shift-x-progress-line.html): a deep
// green-black field with a soft light overhead and a faint green floor, the
// green MONOGRAM logo (assets/images/brand/mage-mark-on-dark.png; no hard-hat
// mark anywhere on the front door), a "Sample project" pill, and the headline
// "Ask. Estimate. Sign. Build. / Get paid."
//
// The ground is the same in light and dark mode: everything drawn on it is
// light-on-night. RN has no radial gradient, so the overhead light and the
// floor glow are stacks of soft ellipses at falling opacity.
import React from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DISPLAY_FONT } from '@/constants/typography';

/** The night field, top to bottom (the design's radial, read as a vertical fall). */
export const NIGHT = {
  top: '#1F3A25',
  mid: '#0F1B13',
  deep: '#070A08',
  /** Light type on the night field. */
  ink: '#FFFFFF',
  /** The secondary line (white at 66 %). */
  soft: 'rgba(255,255,255,0.66)',
  /** "Get paid." — the paid teal, lifted for the dark field. */
  paid: '#62C9B4',
} as const;

const MARK_ON_DARK = require('@/assets/images/brand/mage-mark-on-dark.png');
const MARK_ON_LIGHT = require('@/assets/images/brand/mage-mark-on-light.png');
/** The monogram's own proportions (571 × 657). */
const MARK_RATIO = 571 / 657;

/** Concentric ellipses, faintest outermost: a soft radial light without a gradient primitive. */
function SoftLight({ color, width, height, peak, style }: {
  color: string; width: number; height: number; peak: number; style: StyleProp<ViewStyle>;
}) {
  const rings = [1, 0.82, 0.64, 0.46, 0.3];
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', width, height }, style]}>
      {rings.map((r) => (
        <View
          key={r}
          style={{
            position: 'absolute',
            left: (width * (1 - r)) / 2,
            top: (height * (1 - r)) / 2,
            width: width * r,
            height: height * r,
            borderRadius: (width * r) / 2,
            backgroundColor: color,
            opacity: peak / rings.length,
          }}
        />
      ))}
    </View>
  );
}

/** The night ground, filling its parent. Decorative: touch-through, hidden from a11y. */
export function AuthGround({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <LinearGradient
        colors={[NIGHT.top, NIGHT.mid, NIGHT.deep]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <SoftLight color="#B9E4C1" width={680} height={520} peak={0.22} style={styles.overhead} />
      <SoftLight color="#2F6B3A" width={720} height={360} peak={0.3} style={styles.floor} />
    </View>
  );
}

/** The MAGE ID monogram. `onDark` picks the art for the night ground. */
export function MonogramMark({ height = 44, onDark = true, style }: {
  height?: number; onDark?: boolean; style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ width: Math.round(height * MARK_RATIO), height }, style]}>
      <Image
        source={onDark ? MARK_ON_DARK : MARK_ON_LIGHT}
        style={{ width: '100%', height: '100%' }}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="MAGE ID"
      />
    </View>
  );
}

/** "Sample project": the spine is one sample job, and says so. */
export function SamplePill({ label = 'Sample project', style }: { label?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.pill, style]}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

/** The headline pair and the line under it. */
export function SpineHeadline({ size = 28, style, line0, line1, lede }: {
  size?: number;
  style?: StyleProp<ViewStyle>;
  line0?: StyleProp<TextStyle>;
  line1?: StyleProp<TextStyle>;
  lede?: StyleProp<TextStyle>;
}) {
  const head: TextStyle = { fontSize: size, lineHeight: Math.round(size * 1.08), letterSpacing: -size * 0.022 };
  return (
    <View style={style} accessibilityRole="header">
      <Text style={[styles.headline, head, line0]}>Ask. Estimate. Sign. Build.</Text>
      <Text style={[styles.headline, styles.paid, head, line1]}>Get paid.</Text>
      <Text style={[styles.lede, lede]}>From the first question to the last payment.</Text>
    </View>
  );
}

export const authGroundStyles = StyleSheet.create({
  /** The cream primary on the night field ("Get started"). */
  cta: {
    height: 56,
    borderRadius: 16,
    backgroundColor: '#ECEDE9',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 6,
  },
  ctaText: {
    fontFamily: DISPLAY_FONT.semibold,
    fontSize: 17,
    color: '#151816',
  },
});

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', backgroundColor: NIGHT.mid },
  overhead: { top: -200, alignSelf: 'center', left: '50%', marginLeft: -340 },
  floor: { bottom: -200, left: '50%', marginLeft: -360 },
  pill: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  pillText: {
    fontFamily: DISPLAY_FONT.semibold,
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.8)',
  },
  headline: {
    fontFamily: DISPLAY_FONT.bold,
    color: NIGHT.ink,
  },
  paid: { color: NIGHT.paid },
  lede: {
    fontSize: 15,
    lineHeight: 22,
    color: NIGHT.soft,
    marginTop: 12,
  },
});
