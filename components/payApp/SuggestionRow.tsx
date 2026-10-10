// components/payApp/SuggestionRow.tsx — one line's suggestion, with where it
// came from. Used by Bill This Month and by the schedule of values cards on
// the pay application screen.
//
// A suggestion is drawn dashed and carries its own Accept button. This row
// never writes a figure: `onAccept` is the contractor's tap, and the parent
// is the only thing that changes the line. Until then the line's "This
// Period" is whatever it was.
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { formatMoney } from '@/utils/formatters';
import type { LineAcceptState, LineSuggestionResult } from '@/utils/payApp/suggestPercent';
import { SUGGEST_COPY, changedSentence, fmtPct } from '@/utils/payApp/suggestCopy';
import { makePayAppStyles } from './styles';

export interface SuggestionRowProps {
  result: LineSuggestionResult | undefined;
  state: LineAcceptState;
  /** The percent on the line now, for "You entered 35%". */
  enteredPercent: number | null;
  readOnly?: boolean;
  onAccept: () => void;
  testID?: string;
}

export function SuggestionRow({ result, state, enteredPercent, readOnly, onAccept, testID }: SuggestionRowProps) {
  const styles = useThemedStyles(makePayAppStyles);
  if (!result) return null;
  if (result.kind === 'none') {
    return <Text style={styles.note} testID={testID ? `${testID}-none` : undefined}>{result.sentence}</Text>;
  }
  const s = result.suggestion;
  if (state === 'accepted') {
    return (
      <View style={styles.suggestRow} testID={testID ? `${testID}-accepted` : undefined}>
        <Text style={[styles.note, { flex: 1 }]}>{s.sentence}</Text>
        <View style={styles.tag}><Text style={styles.tagText}>{SUGGEST_COPY.accepted}</Text></View>
      </View>
    );
  }
  if (state === 'changed') {
    return (
      <View style={styles.suggestRow} testID={testID ? `${testID}-changed` : undefined}>
        <Text style={[styles.note, { flex: 1 }]}>{changedSentence(s.percent, enteredPercent ?? 0)}</Text>
        <View style={styles.tag}><Text style={styles.tagText}>{SUGGEST_COPY.yours}</Text></View>
      </View>
    );
  }
  return (
    <View style={styles.suggest} testID={testID ? `${testID}-open` : undefined}>
      <View style={styles.suggestMain}>
        <Text style={styles.suggestFigure}>{`${fmtPct(s.percent)}%  ${formatMoney(s.thisPeriod, 2)}`}</Text>
        <Text style={styles.suggestText}>{s.sentence}</Text>
      </View>
      {readOnly ? null : (
        <Pressable
          onPress={onAccept}
          style={styles.toolBtn}
          accessibilityRole="button"
          accessibilityLabel={`${SUGGEST_COPY.accept} ${fmtPct(s.percent)}%`}
          testID={testID ? `${testID}-accept` : undefined}
        >
          <Text style={styles.toolBtnText}>{SUGGEST_COPY.accept}</Text>
        </Pressable>
      )}
    </View>
  );
}
