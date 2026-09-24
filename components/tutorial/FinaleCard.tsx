// components/tutorial/FinaleCard.tsx — the end of a tutorial: what he just did,
// measured, and the one button that takes him to do it for real.
//
// The stat is MEASURED (utils/tutorial/stats.statLine): the time from his
// first action to the real success signal, plus counts from the real payloads
// — 'Report filed in 34 s · 3 sections from one note'. Never an invented
// comparison (brain-center honesty rule). When the run cannot measure it (he
// skipped the timed step), there is no stat line at all rather than a guess.
//
// The primary button comes from utils/tutorial/handoff.handoffFor: the same
// screen on his newest real job, 'Start your first job' when he has none, or
// the plans page for a feature he practised on the pass but does not own. The
// chain offer is an OFFER — nothing auto-chains.

import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Button } from '@/components/ui/Button';
import { EyebrowLabel } from '@/components/ui/EyebrowLabel';
import type { FinalePresentation } from '@/utils/tutorial/store';

export interface FinaleCardProps {
  finale: FinalePresentation;
  reduceMotion: boolean;
  wide: boolean;
  onAction: (key: string) => void;
}

export function FinaleCard({ finale, reduceMotion, wide, onAction }: FinaleCardProps) {
  const { colors } = useTheme();
  const appear = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(
      ['Practised on the sample.', finale.title, finale.stat ?? ''].filter(Boolean).join(' '),
    );
    if (reduceMotion) return;
    const a = Animated.timing(appear, { toValue: 1, duration: Tokens.motion.duration.base, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once per finale

  return (
    <View style={StyleSheet.absoluteFill} testID="tutorial-finale">
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: Colors.overlay }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View style={styles.center} pointerEvents="box-none">
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.card,
            Tokens.shadow.heavy,
            {
              maxWidth: wide ? 420 : 360,
              backgroundColor: colors.surface,
              borderColor: colors.line,
              opacity: appear,
              transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
            },
          ]}
        >
          <View style={styles.headRow}>
            <EyebrowLabel tone="success">PRACTISED ON THE SAMPLE</EyebrowLabel>
            <Pressable
              onPress={() => onAction('done')}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              style={styles.close}
              testID="tutorial-finale-close"
            >
              <X size={18} strokeWidth={2} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={[Type.title3, { color: colors.text }]}>{finale.title}</Text>
          {finale.stat ? (
            <Text style={[Type.bodyCompactEmphasized, styles.stat, { color: colors.text }]} testID="tutorial-finale-stat">
              {finale.stat}
            </Text>
          ) : null}
          <Text style={[Type.footnote, styles.note, { color: colors.textSecondary }]}>
            That was the real screen on the sample job. Nothing was sent to anyone else.
          </Text>

          <View style={styles.buttons}>
            {finale.primary ? (
              <Button
                label={finale.primary.label}
                variant="primary"
                fullWidth
                onPress={() => onAction(finale.primary!.key)}
                testID="tutorial-finale-primary"
              />
            ) : null}
            {finale.secondary ? (
              <Button
                label={finale.secondary.label}
                variant="secondary"
                fullWidth
                onPress={() => onAction(finale.secondary!.key)}
                testID="tutorial-finale-secondary"
              />
            ) : null}
            {finale.chain ? (
              <Button
                label={finale.chain.label}
                variant="secondary"
                fullWidth
                onPress={() => onAction(finale.chain!.key)}
                testID="tutorial-finale-chain"
              />
            ) : null}
            <Button label="Done" variant="ghost" fullWidth onPress={() => onAction('done')} testID="tutorial-finale-done" />
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  card: {
    width: '100%',
    borderWidth: 1,
    borderRadius: Tokens.radius.lg,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  close: {
    width: Tokens.touchTarget.comfortable,
    height: Tokens.touchTarget.comfortable,
    marginRight: -14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stat: { marginTop: 8 },
  note: { marginTop: 6 },
  buttons: { marginTop: 16, gap: 8 },
});

export default FinaleCard;
