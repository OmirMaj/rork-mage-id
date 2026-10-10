// components/payApp/BillThisMonthLine.tsx — one line of Bill This Month:
// what it was, the percent it goes to, the dollars that puts in this period,
// and the suggestion (with its source) underneath.
//
// The amount on the right is the line's own `thisPeriod`. A suggestion that
// has not been accepted is drawn in its dashed row and is not in that amount.
//
// THE PERCENT FIELD COMMITS AS HE TYPES. A percent the app can read (0 to 100)
// is on the line at once, so the total, the check and a save always see what
// the field shows: there is nothing left waiting for a blur. A value the app
// will not take (over 100, below zero, not a number) is REFUSED WITH THE
// REASON on the line, and the line goes back to what it held when he started
// typing in the field (so "150" does not leave "15" behind).
import React, { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { formatMoney } from '@/utils/formatters';
import type { AIASOVLine } from '@/utils/aiaBilling';
import { roundCents } from '@/utils/invoiceBilling';
import {
  parseTypedPercent, percentOfAnyLine, suggestionAmountNow,
  type LineAcceptState, type LineSuggestionResult,
} from '@/utils/payApp/suggestPercent';
import { NO_SUGGESTION, SUGGEST_COPY, fmtPct } from '@/utils/payApp/suggestCopy';
import { SuggestionRow } from './SuggestionRow';
import { makePayAppStyles } from './styles';

/** What a line held when he put the cursor in its percent field. */
export interface LineBeforeTyping {
  thisPeriod: number;
  suggestedPercent?: number;
  suggestionSource?: string;
  state: LineAcceptState;
}

export interface BillThisMonthLineProps {
  line: AIASOVLine;
  result: LineSuggestionResult | undefined;
  state: LineAcceptState;
  onAccept: () => void;
  /** He typed a total percent complete for the line (0 to 100, already read). */
  onPercent: (percent: number) => void;
  /** What he typed was refused, or he emptied the field: put the line back as it was. */
  onRestore: (before: LineBeforeTyping) => void;
}

export function BillThisMonthLine({ line, result, state, onAccept, onPercent, onRestore }: BillThisMonthLineProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makePayAppStyles);
  const isCredit = line.scheduledValue < 0;
  const wasPct = line.scheduledValue !== 0
    ? (roundCents(line.fromPreviousApp + (isCredit ? 0 : line.materialsPresentlyStored)) / line.scheduledValue) * 100
    : null;
  const nowPct = percentOfAnyLine(line);
  // The field holds what he is typing while the cursor is in it; out of it,
  // it reads the line (so an Accept shows at once).
  const [draft, setDraft] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const focused = useRef(false);
  const before = useRef<LineBeforeTyping | null>(null);
  useEffect(() => { if (!focused.current) setDraft(null); }, [line.thisPeriod]);
  const shown = draft ?? (nowPct == null ? '' : fmtPct(nowPct));

  const billedInFull = result?.kind === 'none' && result.reason === 'billed_in_full';
  const noPercent = line.scheduledValue === 0;

  const typed = (text: string) => {
    setDraft(text);
    const read = parseTypedPercent(text);
    if (read.kind === 'ok') {
      const shownText = text.trim().replace(/\s*%$/, '');
      setRefusal(wasPct != null && read.percent < wasPct - 0.05
        ? SUGGEST_COPY.pctBelowBilled(shownText, fmtPct(wasPct))
        : null);
      onPercent(read.percent);
      return;
    }
    // Nothing he typed stands: the line is as it was before this field.
    if (before.current) onRestore(before.current);
    if (read.kind === 'empty') { setRefusal(null); return; }
    setRefusal(read.why === 'over_100' ? SUGGEST_COPY.pctOver(text.trim())
      : read.why === 'below_zero' ? SUGGEST_COPY.pctBelowZero
        : SUGGEST_COPY.pctNotNumber(text.trim()));
  };

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
              onChangeText={typed}
              onFocus={() => {
                focused.current = true;
                setRefusal(null);
                before.current = {
                  thisPeriod: line.thisPeriod,
                  suggestedPercent: line.suggestedPercent,
                  suggestionSource: line.suggestionSource,
                  state,
                };
              }}
              onBlur={() => { focused.current = false; setDraft(null); }}
              keyboardType="decimal-pad"
              selectTextOnFocus
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={`Percent Complete for Item ${line.itemNo}`}
              testID={`btm-pct-${line.id}`}
            />
            <Text style={styles.pctSign}>%</Text>
            <Text
              style={[styles.lineAmount, line.thisPeriod === 0 && styles.lineAmountZero]}
              testID={`btm-amount-${line.id}`}
            >
              {formatMoney(line.thisPeriod, 2)}
            </Text>
          </View>
          {refusal ? (
            <Text style={styles.fieldError} accessibilityLiveRegion="polite" testID={`btm-pct-refused-${line.id}`}>{refusal}</Text>
          ) : null}
          {isCredit ? (
            <Text style={styles.note} testID={`btm-credit-${line.id}`}>{SUGGEST_COPY.creditLine}</Text>
          ) : (
            <SuggestionRow
              result={result}
              state={state}
              enteredPercent={nowPct}
              amountNow={result?.kind === 'suggest' ? suggestionAmountNow(line, result.suggestion) : undefined}
              onAccept={onAccept}
              testID={`btm-suggest-${line.id}`}
            />
          )}
        </>
      )}
    </View>
  );
}
