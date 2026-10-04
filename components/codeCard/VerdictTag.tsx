// components/codeCard/VerdictTag.tsx — the ink verdict block on a code card:
// a solid "Required" block, an outlined "Limit", a quiet "Not required". It
// reads at arm's length and stays the loudest thing on the card in both
// themes (it flips light-on-dark in dark mode through the theme tokens).

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Check, Minus, Ruler } from 'lucide-react-native';
import type { CodeVerdict } from '@/utils/codeCard/types';
import { useCodeCardPalette, type CodeCardPalette } from './palette';

export const VERDICT_LABEL: Readonly<Record<CodeVerdict, string>> = Object.freeze({
  required: 'Required',
  limit: 'Limit',
  not_required: 'Not required',
});

export interface VerdictTagProps {
  verdict: CodeVerdict;
  sunlight?: boolean;
  testID?: string;
}

export function VerdictTag({ verdict, sunlight, testID }: VerdictTagProps) {
  const P = useCodeCardPalette(sunlight);
  const styles = useMemo(() => makeStyles(P), [P]);
  const label = VERDICT_LABEL[verdict];
  const box = verdict === 'required' ? styles.solid : verdict === 'limit' ? styles.outline : styles.quiet;
  const ink = verdict === 'required' ? P.verdictInk : verdict === 'limit' ? P.ink : P.ink2;
  const Icon = verdict === 'required' ? Check : verdict === 'limit' ? Ruler : Minus;
  return (
    <View
      style={[styles.tag, box]}
      accessible
      accessibilityLabel={`Verdict: ${label}`}
      testID={testID}
    >
      <Icon size={13} color={ink} strokeWidth={3} />
      <Text style={[styles.label, { color: ink }]}>{label}</Text>
    </View>
  );
}

/** The small outlined "Sample" mark every sample card carries. */
export function SampleTag({ sunlight, testID }: { sunlight?: boolean; testID?: string }) {
  const P = useCodeCardPalette(sunlight);
  const styles = useMemo(() => makeStyles(P), [P]);
  return (
    <View style={styles.sample} testID={testID} accessible accessibilityLabel="Sample, not a real answer">
      <Text style={styles.sampleText}>Sample</Text>
    </View>
  );
}

const makeStyles = (P: CodeCardPalette) =>
  StyleSheet.create({
    tag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      height: 24 + (P.sunlight ? 2 : 0),
      paddingLeft: 6,
      paddingRight: 8,
      borderRadius: 6,
    },
    solid: { backgroundColor: P.verdictBg },
    outline: { borderWidth: 1.5, borderColor: P.ink },
    quiet: { borderWidth: 1.5, borderColor: P.line },
    label: {
      fontSize: 11.5 + (P.sunlight ? 1 : 0),
      fontWeight: '700',
      letterSpacing: 1.3,
      textTransform: 'uppercase',
    },
    sample: {
      height: 18,
      paddingHorizontal: 6,
      borderRadius: 5,
      borderWidth: P.rule,
      borderColor: P.line,
      justifyContent: 'center',
    },
    sampleText: {
      fontSize: 10.5,
      fontWeight: '600',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: P.ink3,
    },
  });
