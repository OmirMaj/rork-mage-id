// components/ErrorState.tsx — the load-failure branch, lifted out of one screen
// so the other ~150 can have one.
//
// WHY THIS EXISTS. The 2026-09-07 app-experience audit ("Worth doing" #8, and
// the honesty theme behind the whole "Do now" tier) found that almost no screen
// in the app distinguishes "you have nothing yet" from "the read failed".
// EmptyState — the friendly, animated, CTA-carrying primitive — was the ONLY
// thing most lists rendered when they had no rows, so a GC whose session had
// expired was told his book of work was empty and handed a "Create your first
// project" button.
//
// This component is a straight LIFT of the local ErrorState that already
// worked at app/prequal-form.tsx:555 (warning triangle, title, body, one way
// out), generalised on exactly three axes the call sites needed:
//   • `onRetry` — the load-failure sites have something to re-run
//     (retryRemoteReads, a react-query refetch). The prequal form did not.
//   • `steps`   — same contract as EmptyState's, so the failure screen can
//     teach the way out instead of stopping at "something went wrong".
//     app/(tabs)/summary/index.tsx set that precedent for a failed read.
//   • `icon`    — CloudOff for an unreachable backend, the default triangle
//     for everything else.
//
// The primary button carries WHITE text, so its fill is accentFill (#BC440C,
// 5.29:1) and never the brand accent (#FF6A1A, 2.87:1) — the standing rule in
// constants/colors.ts, and the reason the prequal original already used
// t.accentFill.
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface ErrorStateProps {
  /** Short and plain — "Couldn't reach MAGE", not "Error". */
  title: string;
  /** What happened, and one concrete next step. utils/errorCopy.ts composes
   *  this from a thrown exception; hand-written copy is fine too. */
  body: string;
  /** Primary way out. Re-runs whatever failed. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Secondary way out — the prequal form's original "Close". */
  onBack?: () => void;
  backLabel?: string;
  /** 1-3 short sentences, same contract as EmptyState's. */
  steps?: string[];
  /** Defaults to a warning triangle in warningLabel ink. */
  icon?: React.ReactNode;
  testID?: string;
}

export default function ErrorState({
  title, body, onRetry, retryLabel = 'Try again',
  onBack, backLabel = 'Close', steps, icon, testID = 'error-state',
}: ErrorStateProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.wrap} testID={testID}>
      {icon ?? <AlertTriangle size={32} color={themeColors.warningLabel} strokeWidth={1.75} />}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>

      {steps && steps.length > 0 && (
        <View style={styles.steps}>
          {steps.map((step, idx) => (
            <View key={idx} style={styles.stepRow}>
              <View style={styles.stepBullet}>
                <Text style={styles.stepBulletText}>{idx + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
      )}

      {onRetry && (
        <TouchableOpacity onPress={onRetry} style={styles.primaryBtn} activeOpacity={0.85}
          accessibilityRole="button" accessibilityLabel={retryLabel} testID={`${testID}-retry`}>
          <Text style={styles.primaryBtnText}>{retryLabel}</Text>
        </TouchableOpacity>
      )}
      {onBack && (
        <TouchableOpacity onPress={onBack} style={styles.secondaryBtn} activeOpacity={0.7}
          accessibilityRole="button" accessibilityLabel={backLabel} testID={`${testID}-back`}>
          <Text style={styles.secondaryBtnText}>{backLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: Type.subheadline.fontSize, fontWeight: '700', color: t.text, marginTop: 12, textAlign: 'center' },
  body: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 18, maxWidth: 320 },
  steps: { alignSelf: 'stretch', maxWidth: 340, width: '100%', gap: 8, marginTop: 16 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepBullet: {
    width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: t.warningLabel + '55', backgroundColor: t.warningSoft, marginTop: 1, flexShrink: 0,
  },
  stepBulletText: { fontSize: 10, fontWeight: '800', color: t.warningLabel },
  stepText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  // White label → accentFill (5.29:1), never the 2.87:1 brand accent.
  primaryBtn: { marginTop: 20, paddingHorizontal: 24, paddingVertical: 10, borderRadius: Tokens.radius.md, backgroundColor: t.accentFill },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: Type.footnote.fontSize },
  secondaryBtn: { marginTop: 10, paddingHorizontal: 16, paddingVertical: 8 },
  secondaryBtnText: { color: t.textSecondary, fontWeight: '600', fontSize: Type.footnote.fontSize },
});
