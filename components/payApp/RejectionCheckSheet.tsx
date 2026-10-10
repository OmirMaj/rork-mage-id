// components/payApp/RejectionCheckSheet.tsx — "Things A Reviewer May
// Question", shown before the certify slide and reachable any time.
//
// The list is utils/payApp/rejectionCheck.runRejectionCheck on the
// application on screen. This sheet draws it and nothing else:
//   • It never blocks. "Continue Anyway" is always there when the caller is on
//     the way to certify, and it is never disabled.
//   • No tick, no score, no colour that reads as a pass. A check that found
//     nothing says "Nothing flagged" in the muted ink.
//   • The lead sentence and the "Not Checked By MAGE ID" block are drawn every
//     time, flagged or not.
//   • The result is not saved and not printed.
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Sheet } from '@/components/ui';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { firstLineFinding, type CheckResult } from '@/utils/payApp/rejectionCheck';
import { REJECTION_COPY } from '@/utils/payApp/rejectionCopy';
import { makePayAppStyles } from './styles';

export interface RejectionCheckSheetProps {
  visible: boolean;
  result: CheckResult | null;
  onClose: () => void;
  /** Close the sheet and bring that line into view. */
  onGoToLine?: (lineId: string) => void;
  /** Set when the contractor is on the way to certify or save: draws Continue Anyway. */
  onContinue?: () => void;
  testID?: string;
}

export function RejectionCheckSheet({ visible, result, onClose, onGoToLine, onContinue, testID = 'rejection-check' }: RejectionCheckSheetProps) {
  const styles = useThemedStyles(makePayAppStyles);
  const fix = result ? firstLineFinding(result) : null;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={REJECTION_COPY.title}
      subtitle={REJECTION_COPY.subtitle}
      size="form"
      testID={testID}
      footer={(
        <View style={styles.actions}>
          {fix && onGoToLine ? (
            <Button
              label={REJECTION_COPY.fixLine(fix.itemNo)}
              onPress={() => onGoToLine(fix.lineId)}
              fullWidth
              testID={`${testID}-fix`}
            />
          ) : null}
          {onContinue ? (
            <Button
              label={REJECTION_COPY.continueAnyway}
              onPress={onContinue}
              variant={fix && onGoToLine ? 'secondary' : 'primary'}
              fullWidth
              testID={`${testID}-continue`}
            />
          ) : (
            <Button label={REJECTION_COPY.back} onPress={onClose} variant="secondary" fullWidth testID={`${testID}-back`} />
          )}
        </View>
      )}
    >
      {result ? (
        <View style={{ gap: 10 }}>
          <Text style={styles.lead} testID={`${testID}-lead`}>{REJECTION_COPY.lead}</Text>

          <Text style={styles.heading}>{REJECTION_COPY.flaggedHeading(result.flagged.length)}</Text>
          {result.flagged.map((f, i) => (
            <View key={`${f.id}-${f.lineId ?? ''}-${i}`} style={styles.finding} testID={`${testID}-finding-${f.id}`}>
              <Text style={styles.findingName}>{f.title}</Text>
              <Text style={styles.findingDetail}>{f.detail}</Text>
              {f.action && onGoToLine ? (
                <Pressable
                  onPress={() => onGoToLine(f.action!.lineId)}
                  style={styles.findingLinkBtn}
                  accessibilityRole="button"
                  accessibilityLabel={f.action.label}
                >
                  <Text style={styles.findingLink}>{f.action.label}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}

          {result.ranClean.length > 0 ? (
            <View>
              <Text style={styles.heading}>{REJECTION_COPY.cleanHeading(result.ranClean.length)}</Text>
              {result.ranClean.map(c => (
                <View key={c.id} style={styles.cleanRow} testID={`${testID}-clean-${c.id}`}>
                  <Text style={styles.cleanLabel}>{c.label}</Text>
                  <Text style={styles.cleanState}>{REJECTION_COPY.nothingFlagged}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {result.notRun.length > 0 ? (
            <View>
              <Text style={styles.heading}>{REJECTION_COPY.notRunHeading(result.notRun.length)}</Text>
              {result.notRun.map(n => (
                <View key={n.id} style={styles.cleanRow} testID={`${testID}-notrun-${n.id}`}>
                  <Text style={styles.cleanLabel}>{n.label}</Text>
                  <Text style={styles.cleanState}>{n.why}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={styles.notChecked} testID={`${testID}-not-checked`}>
            <Text style={styles.notCheckedStrong}>{REJECTION_COPY.notCheckedLabel}</Text>
            {` ${REJECTION_COPY.notCheckedBody}`}
          </Text>
        </View>
      ) : null}
    </Sheet>
  );
}
