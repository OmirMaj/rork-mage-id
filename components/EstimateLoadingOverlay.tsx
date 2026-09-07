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
  Modal, View, Text, StyleSheet, Animated, Easing, Platform, TouchableOpacity,
} from 'react-native';
import { CraneSvg } from '@/components/CraneLoader';
import ThinkingStates from '@/components/ThinkingStates';
import { CONSTRUCTION_FACTS } from '@/utils/constructionFacts';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface Props {
  visible: boolean;
  /** Optional override of the title. Default: "Generating estimate…" */
  title?: string;
  /** Optional override of the subtitle below the title. */
  subtitle?: string;
  /** When provided, a Cancel button renders below the fun fact and calls
   *  this on tap. The in-flight AI request is dropped (the AbortController
   *  is internal to mageAI, so we just stop waiting for it). */
  onCancel?: () => void;
  /** When provided, replaces the static subtitle with a labeled thinking
   *  sequence that advances while visible. */
  thinkingSteps?: string[];
}

// Shared, accuracy-checked set (utils/constructionFacts.ts) — estimating math,
// materials, jobsite, safety, code, money, and a little history.
const FUN_FACTS: readonly string[] = CONSTRUCTION_FACTS;

export default function EstimateLoadingOverlay({ visible, title, subtitle, thinkingSteps, onCancel }: Props) {
  const styles = useThemedStyles(makeStyles);
  const [factIdx, setFactIdx] = useState(0);
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;
  const factOpacity = useRef(new Animated.Value(1)).current;

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
          <View style={styles.scene}>
            <CraneSvg size={288} />
          </View>

          <Text style={styles.title}>{title ?? 'Generating estimate…'}</Text>
          {thinkingSteps && thinkingSteps.length > 0 ? (
            <ThinkingStates steps={thinkingSteps} active={visible} />
          ) : (
            <Text style={styles.subtitle}>
              {subtitle ?? 'The model is estimating from your scope plus the rates listed above — nothing is pulled from a price list. Usually 8 to 30 seconds.'}
            </Text>
          )}

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

          {onCancel ? (
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel AI generation"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function Dot({ a }: { a: Animated.Value }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  const opacity    = a.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  return (
    <Animated.View
      style={[styles.dot, { transform: [{ translateY }], opacity }]}
    />
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
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
    backgroundColor: t.surface,
    borderRadius: 22,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 16,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 18px 48px rgba(0,0,0,0.45)' as any }
      : { shadowColor: '#000', shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.45, shadowRadius: 28, elevation: 18 }),
  },
  scene: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  title: {
    fontSize: 19, fontWeight: '800',
    color: t.text, letterSpacing: -0.3,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: Type.footnote.fontSize, color: t.textSecondary,
    textAlign: 'center', lineHeight: 19, maxWidth: 300,
  },
  dotsRow: {
    flexDirection: 'row', gap: 8,
    marginTop: 4, marginBottom: 4,
  },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: t.accent,
  },
  factCard: {
    width: '100%',
    paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: Tokens.radius.lg,
    backgroundColor: Colors.fillSecondary,
    borderWidth: 1, borderColor: t.line,
    gap: 8,
  },
  factLabel: {
    fontSize: 10, fontWeight: '800',
    color: t.accent, letterSpacing: 1.4,
  },
  factText: {
    fontSize: Type.footnote.fontSize, color: t.text,
    lineHeight: 19,
  },
  cancelBtn: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
    backgroundColor: Colors.fillSecondary,
  },
  cancelText: {
    fontSize: Type.footnote.fontSize,
    color: t.text,
    fontWeight: '600',
  },
});
