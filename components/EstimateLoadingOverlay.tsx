// EstimateLoadingOverlay
//
// Full-screen modal that shows while the AI estimate is being generated.
// Replaces the no-feedback dead-screen state with something engaging:
// progress dots + a rotating construction fun fact every 4s.
//
// Why a modal: the estimate flow takes 8-30 seconds depending on tier and
// project complexity. Without a real loading screen the user thinks the
// app froze and bails. The fun facts give them something to read so the
// wait feels deliberate.

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, Animated, Easing, Platform,
} from 'react-native';
import { Sparkles, Hammer } from 'lucide-react-native';
import { Colors } from '@/constants/colors';

interface Props {
  visible: boolean;
  /** Optional override of the title. Default: "Generating estimate…" */
  title?: string;
  /** Optional override of the subtitle below the title. */
  subtitle?: string;
}

const FUN_FACTS: string[] = [
  "The Empire State Building was completed in just 410 days — under budget by $5M (1931).",
  "Hoover Dam used enough concrete to build a 16-foot-wide highway from San Francisco to New York.",
  "The Burj Khalifa's foundation took 22 hours of continuous concrete pouring — 12,500 cubic meters.",
  "The Pyramids of Giza are still the most precisely-aligned major structures ever built. Margin of error: 0.05°.",
  "Modern skyscrapers sway up to 3 feet in high wind — by design.",
  "A 2x4 isn't actually 2 by 4 inches. It's 1.5 by 3.5. Lumber is sized green; it shrinks as it dries.",
  "Concrete keeps gaining strength for 100+ years after it's poured. The Pantheon's dome is still curing.",
  "The Golden Gate Bridge requires roughly 25 painters working full-time, year-round, just on touch-ups.",
  "A typical 2,500 sq ft home contains over 16,000 nails.",
  "Drywall was invented in 1916 and called \"Sackett Board.\" It was a hard sell — plaster was tradition.",
  "The Channel Tunnel digging machines were buried in concrete after the dig — they couldn't reverse out.",
  "Most residential framing crews can frame an entire house in 1-2 weeks. Foundation took longer.",
  "Standard ceiling heights crept up from 8' (1950s) to 9' (today). Trim profiles got taller too.",
  "The world's tallest crane is on top of the Burj Khalifa — it'll be the last thing taken down.",
  "Concrete's CO2 footprint is 8% of global emissions. Cement-free \"green\" concretes are catching up.",
  "Diamond blade saws cut through 6\" of cured concrete at about 1 inch per minute.",
  "OSHA Safety Harness saves an estimated 1,200 construction lives per year in the US alone.",
  "The Notre Dame fire in 2019 used 460 tons of restored medieval oak for the spire — same species, same angles.",
  "A typical residential project spends 30-40% of its budget on labor, 50-60% on materials, 5-10% on overhead.",
  "Drywall screws are slightly different from wood screws — coarser thread, sharper tip. Mixing them shows.",
];

export default function EstimateLoadingOverlay({ visible, title, subtitle }: Props) {
  const [factIdx, setFactIdx] = useState(0);
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;
  const factOpacity = useRef(new Animated.Value(1)).current;
  const iconRotate = useRef(new Animated.Value(0)).current;

  // Rotate fact every 4 seconds with a quick fade.
  useEffect(() => {
    if (!visible) return;
    setFactIdx(Math.floor(Math.random() * FUN_FACTS.length));
    const id = setInterval(() => {
      Animated.sequence([
        Animated.timing(factOpacity, { toValue: 0, duration: 240, useNativeDriver: true }),
        Animated.timing(factOpacity, { toValue: 1, duration: 240, useNativeDriver: true }),
      ]).start();
      setTimeout(() => setFactIdx(i => (i + 1 + Math.floor(Math.random() * (FUN_FACTS.length - 1))) % FUN_FACTS.length), 240);
    }, 4000);
    return () => clearInterval(id);
  }, [visible, factOpacity]);

  // Bouncing progress dots.
  useEffect(() => {
    if (!visible) return;
    const animate = (val: Animated.Value, delay: number) => Animated.loop(
      Animated.sequence([
        Animated.timing(val, { toValue: 1, duration: 380, delay, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(val, { toValue: 0, duration: 380, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    const a = animate(dot1, 0);
    const b = animate(dot2, 130);
    const c = animate(dot3, 260);
    a.start(); b.start(); c.start();
    return () => { a.stop(); b.stop(); c.stop(); };
  }, [visible, dot1, dot2, dot3]);

  // Slow rotation on the hammer icon.
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.timing(iconRotate, { toValue: 1, duration: 4500, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, iconRotate]);

  const rotate = iconRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={() => { /* not dismissable while generating */ }}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconStack}>
            <Animated.View style={[styles.iconRing, { transform: [{ rotate }] }]}>
              <Hammer size={28} color={Colors.primary} />
            </Animated.View>
            <View style={styles.iconBadge}>
              <Sparkles size={11} color="#FFF" />
            </View>
          </View>

          <Text style={styles.title}>{title ?? 'Generating estimate…'}</Text>
          <Text style={styles.subtitle}>
            {subtitle ?? 'AI is pulling materials, labor, and pricing for your project. Hang tight — usually 8 to 30 seconds.'}
          </Text>

          <View style={styles.dotsRow}>
            <Dot a={dot1} />
            <Dot a={dot2} />
            <Dot a={dot3} />
          </View>

          <View style={styles.factCard}>
            <Text style={styles.factLabel}>WHILE YOU WAIT</Text>
            <Animated.Text style={[styles.factText, { opacity: factOpacity }]}>
              {FUN_FACTS[factIdx]}
            </Animated.Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Dot({ a }: { a: Animated.Value }) {
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  const opacity    = a.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  return (
    <Animated.View
      style={[styles.dot, { transform: [{ translateY }], opacity }]}
    />
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(11, 13, 16, 0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: Colors.surface,
    borderRadius: 22,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 16,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 18px 48px rgba(0,0,0,0.45)' as any }
      : { shadowColor: '#000', shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.45, shadowRadius: 28, elevation: 18 }),
  },
  iconStack: {
    width: 72, height: 72,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  iconRing: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.primary + '30',
  },
  iconBadge: {
    position: 'absolute',
    top: -4, right: -4,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.surface,
  },
  title: {
    fontSize: 19, fontWeight: '800',
    color: Colors.text, letterSpacing: -0.3,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13, color: Colors.textSecondary,
    textAlign: 'center', lineHeight: 19, maxWidth: 300,
  },
  dotsRow: {
    flexDirection: 'row', gap: 8,
    marginTop: 4, marginBottom: 4,
  },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  factCard: {
    width: '100%',
    paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Colors.fillSecondary,
    borderWidth: 1, borderColor: Colors.borderLight,
    gap: 8,
  },
  factLabel: {
    fontSize: 10, fontWeight: '800',
    color: Colors.primary, letterSpacing: 1.4,
  },
  factText: {
    fontSize: 13, color: Colors.text,
    lineHeight: 19,
  },
});
