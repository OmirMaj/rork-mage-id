// components/tutorial/CoachCard.tsx — the one-line instruction beside the
// spotlight.
//
// Contents (spec §6): 'STEP 2 OF 5', one verb-first instruction, an optional
// detail, an X labelled 'End tutorial' (48 pt hit area), Next on LOOK steps
// only, a late 'Skip this step', and 'Do it for me' once the step has an
// assist and he has been stuck (at once with a screen reader).
//
// Style: the surface token with a 1 px line border and the large radius. The
// accent is never the card background (brain-center anti-slop rule), so the
// only filled thing on it is Next. No emoji. The instruction is a polite live
// region, so VoiceOver / TalkBack (aria-live on web) read each new step.
//
// Placement is decided by the layer (placement.placeCard) from this card's
// MEASURED height, reported through onHeight — that is how Dynamic Type is
// handled: a bigger font makes a taller card, which moves to where it fits.

import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Button } from '@/components/ui/Button';
import { EyebrowLabel } from '@/components/ui/EyebrowLabel';

export interface CoachCardProps {
  stepNumber: number;
  stepCount: number;
  text: string;
  detail: string;
  /** Look steps: the only way they move on. */
  next: boolean;
  /** Offer 'Skip this step' (after 15 s stuck, 4 s missing, or a screen reader). */
  skip: boolean;
  /** 'Can't find it' wording for the skip (the target never mounted). */
  missing: boolean;
  /** Offer 'Do it for me'. */
  assist: boolean;
  /** The real failure (invoice.send.failed), shown verbatim. */
  failureReason: string | null;
  /** Card mode with an off-screen target. */
  scrollHint: 'up' | 'down' | null;
  /** Caret x inside the card, and which edge it sits on. */
  caret: { x: number; side: 'top' | 'bottom' } | null;
  width: number;
  shake: Animated.Value;
  onHeight: (h: number) => void;
  onNext: () => void;
  onSkip: () => void;
  onAssist: () => void;
  onExit: () => void;
}

export function CoachCard(p: CoachCardProps) {
  const { colors } = useTheme();
  const eyebrow = p.stepCount > 0 ? `STEP ${p.stepNumber} OF ${p.stepCount}` : 'TUTORIAL';

  return (
    <Animated.View
      testID="tutorial-coach-card"
      onLayout={e => p.onHeight(e.nativeEvent.layout.height)}
      style={[
        styles.card,
        Tokens.shadow.heavy,
        {
          width: p.width,
          backgroundColor: colors.surface,
          borderColor: colors.line,
          transform: [{ translateX: p.shake }],
        },
      ]}
    >
      {p.caret ? (
        <View
          pointerEvents="none"
          style={[
            styles.caret,
            {
              left: p.caret.x - 7,
              backgroundColor: colors.surface,
              borderColor: colors.line,
            },
            p.caret.side === 'top' ? styles.caretTop : styles.caretBottom,
          ]}
        />
      ) : null}

      <View style={styles.headRow}>
        <View style={styles.eyebrow}>
          <EyebrowLabel tone="neutral">{eyebrow}</EyebrowLabel>
        </View>
        <Pressable
          onPress={p.onExit}
          accessibilityRole="button"
          accessibilityLabel="End tutorial"
          hitSlop={8}
          style={styles.close}
          testID="tutorial-end"
        >
          <X size={18} strokeWidth={2} color={colors.textSecondary} />
        </Pressable>
      </View>

      <Text
        style={[Type.subheadline, styles.instruction, { color: colors.text }]}
        accessibilityLiveRegion="polite"
        testID="tutorial-card-text"
      >
        {p.text}
      </Text>
      {p.detail ? <Text style={[Type.footnote, { color: colors.textSecondary }]}>{p.detail}</Text> : null}
      {p.failureReason ? (
        <Text style={[Type.footnoteEmphasized, styles.failure, { color: colors.dangerLabel }]} accessibilityLiveRegion="assertive">
          {p.failureReason}
        </Text>
      ) : null}
      {p.scrollHint ? (
        <Text style={[Type.footnoteEmphasized, styles.hint, { color: colors.textSecondary }]}>
          {p.scrollHint === 'down' ? 'Scroll down to find it.' : 'Scroll up to find it.'}
        </Text>
      ) : null}

      {p.next || p.skip || p.assist ? (
        <View style={styles.actions}>
          {p.skip ? (
            <Pressable onPress={p.onSkip} accessibilityRole="button" hitSlop={8} style={styles.link} testID="tutorial-skip-step">
              <Text style={[Type.footnoteEmphasized, { color: colors.textSecondary }]}>
                {p.missing ? "Can't find it — Skip step" : 'Skip this step'}
              </Text>
            </Pressable>
          ) : null}
          {p.assist ? (
            <Pressable onPress={p.onAssist} accessibilityRole="button" hitSlop={8} style={styles.link} testID="tutorial-assist">
              <Text style={[Type.footnoteEmphasized, { color: colors.accentLabel }]}>Do it for me</Text>
            </Pressable>
          ) : null}
          <View style={styles.spacer} />
          {p.next ? <Button label="Next" variant="primary" size="sm" onPress={p.onNext} testID="tutorial-next" /> : null}
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: Tokens.radius.lg,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { flexShrink: 1 },
  close: {
    width: Tokens.touchTarget.comfortable,
    height: Tokens.touchTarget.comfortable,
    marginRight: -14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  instruction: { fontWeight: '600', marginBottom: 4 },
  failure: { marginTop: 6 },
  hint: { marginTop: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 10, gap: 12 },
  link: { minHeight: Tokens.touchTarget.min, justifyContent: 'center' },
  spacer: { flex: 1 },
  caret: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderWidth: 1,
    transform: [{ rotate: '45deg' }],
  },
  caretTop: { top: -8, borderRightWidth: 0, borderBottomWidth: 0 },
  caretBottom: { bottom: -8, borderLeftWidth: 0, borderTopWidth: 0 },
});

export default CoachCard;
