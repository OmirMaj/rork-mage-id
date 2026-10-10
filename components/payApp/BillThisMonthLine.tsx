// components/payApp/BillThisMonthLine.tsx — one line of Bill This Month:
// what it was, the percent it goes to, the dollars that puts in this period,
// and the suggestion (with its source) underneath.
//
// The amount on the right is the line's own `thisPeriod`. A suggestion that
// has not been accepted is drawn in its dashed row and is not in that amount.
import React, { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { formatMoney } from '@/utils/formatters';
import type { AIASOVLine } from '@/utils/aiaBilling';
import { roundCents } from '@/utils/invoiceBilling';
import { parseGridNumber } from '@/utils/dataTable';
import { percentOfLine, type LineAcceptState, type LineSuggestionResult } from '@/utils/payApp/suggestPercent';
import { NO_SUGGESTION, SUGGEST_COPY, fmtPct } from '@/utils/payApp/suggestCopy';
import { SuggestionRow } from './SuggestionRow';
import { makePayAppStyles } from './styles';

export interface BillThisMonthLineProps {
  line: AIASOVLine;
  result: LineSuggestionResult | undefined;
  state: LineAcceptState;
  onAccept: () => void;
  /** He typed a total percent complete for the line. */
  onPercent: (percent: number) => void;
}

export function BillThisMonthLine({ line, result, state, onAccept, onPercent }: BillThisMonthLineProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makePayAppStyles);
  const wasPct = line.scheduledValue > 0
    ? (roundCents(line.fromPreviousApp + line.materialsPresentlyStored) / line.scheduledValue) * 100
    : null;
  const nowPct = percentOfLine(line);
  // The field holds what he is typing; it re-reads the line when the line
  // changes from outside it (an accept).
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => { setDraft(null); }, [line.thisPeriod]);
  const shown = draft ?? (nowPct == null ? '' : fmtPct(nowPct));

  const billedInFull = result?.kind === 'none' && result.reason === 'billed_in_full';
  const noPercent = !(line.scheduledValue > 0);

  return (
    <View style={styles.line} testID={`btm-line-${line.id}`}>
      <View style={styles.lineTop}>
        <Text style={styles.lineNo}>{line.itemNo}</Text>
        <Text style={styles.lineName} numberOfLines={2}>{line.description || `Item ${line.itemNo}`}</Text>
        <Text style={styles.lineValue}>{formatMoney(line.scheduledValue, 2)}</Text>
      </View>
      {billedInFull ? (
        <Text style={styles.lineDone}>{NO_SUGGESTION.billed_in_full}</Text>
      ) : noPercent ? (
        <Text style={styles.lineDone}>{NO_SUGGESTION.not_positive_value}</Text>
      ) : (
        <>
          <View style={styles.lineMid}>
            <Text style={styles.lineWas}>{`${SUGGEST_COPY.wasTo(fmtPct(wasPct ?? 0))}  ${SUGGEST_COPY.to}`}</Text>
            <TextInput
              style={styles.pctInput}
              value={shown}
              onChangeText={setDraft}
              onBlur={() => {
                if (draft == null) return;
                const n = parseGridNumber(draft);
                setDraft(null);
                if (n != null && n >= 0 && n <= 100) onPercent(n);
              }}
              keyboardType="decimal-pad"
              selectTextOnFocus
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={`Percent Complete for Item ${line.itemNo}`}
              testID={`btm-pct-${line.id}`}
            />
            <Text style={styles.pctSign}>%</Text>
            <Text
              style={[styles.lineAmount, !(line.thisPeriod > 0) && styles.lineAmountZero]}
              testID={`btm-amount-${line.id}`}
            >
              {formatMoney(line.thisPeriod, 2)}
            </Text>
          </View>
          <SuggestionRow
            result={result}
            state={state}
            enteredPercent={nowPct}
            onAccept={onAccept}
            testID={`btm-suggest-${line.id}`}
          />
        </>
      )}
    </View>
  );
}
