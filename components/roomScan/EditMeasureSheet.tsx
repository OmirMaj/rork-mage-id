// components/roomScan/EditMeasureSheet.tsx — type a tape measurement over a scanned number.
//
// The person types what the tape says ("8 ft 2 in", "8 2", "98 in"). The sheet
// reads it with utils/roomScan/units.parseTapeMeasure, the one reader, and
// hands back metres. It changes nothing by itself: the caller applies the
// correction (utils/roomScan/editsCore), which records it as typed by hand.
//
// WHAT HE TYPED IS SHOWN BACK BEFORE IT IS USED. A bare number is FEET, so
// "98" for a 98 inch wall would become 98 ft. The sheet shows "Reads as 98 ft
// 0 in" under the field as he types, and when the reading is more than double
// or less than half of what the plan shows (units.tapeFarFromScan) the first
// tap on Use This Number only asks again. The same text tapped a second time
// goes through: a scan can be that wrong, and the tape wins.
import React, { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Sheet } from '@/components/ui';
import type { RoomScanCopy, RoomScanEditKind } from '@/hooks/useRoomScanCopy';
import { formatFeetInches, parseTapeMeasure, tapeFarFromScan } from '@/utils/roomScan/units';
import { makeRoomScanStyles } from './styles';

export interface EditTarget {
  kind: RoomScanEditKind;
  /** What is being fixed, in words ("Wall 2", "Door"). */
  what: string;
  /** The value on the plan now, metres. 0 when the scan gave none. */
  currentM: number;
}

export function EditMeasureSheet({ target, copy, onCancel, onSave }: {
  target: EditTarget | null;
  copy: RoomScanCopy;
  onCancel: () => void;
  onSave: (metres: number) => void;
}) {
  const styles = useThemedStyles(makeRoomScanStyles);
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  /** The text he was asked about once already. The same text again is his answer. */
  const [asked, setAsked] = useState<string | null>(null);
  useEffect(() => { setText(''); setBad(false); setAsked(null); }, [target]);
  if (!target) return null;
  const reading = parseTapeMeasure(text);
  const far = reading != null && tapeFarFromScan(reading, target.currentM);
  const submit = () => {
    if (reading == null) { setBad(true); return; }
    if (far && asked !== text) { setAsked(text); return; }
    onSave(reading);
  };
  return (
    <Sheet
      visible
      onClose={onCancel}
      size="form"
      title={copy.editTitleLabel(target.kind)}
      subtitle={target.what}
      testID="scan-edit-sheet"
      primaryAction={{ label: copy.editSaveLabel, onPress: submit, testID: 'scan-edit-save' }}
      secondaryAction={{ label: copy.cancelLabel, onPress: onCancel }}
    >
      <View style={{ gap: 10 }}>
        {target.currentM > 0 && (
          <Text style={styles.rowSub}>{copy.editScanValueSub(formatFeetInches(target.currentM))}</Text>
        )}
        <Text style={styles.eyebrow}>{copy.editInputLabel}</Text>
        <TextInput
          testID="scan-edit-input"
          style={styles.input}
          value={text}
          onChangeText={(v) => { setText(v); setBad(false); setAsked(null); }}
          placeholderTextColor={colors.textMuted}
          autoFocus
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
          onSubmitEditing={submit}
          accessibilityLabel={copy.editInputLabel}
        />
        {reading != null && <Text style={styles.rowLabel} testID="scan-edit-reads-as">{copy.editReadsAsSub(formatFeetInches(reading))}</Text>}
        {far && asked === text && reading != null && (
          <View style={styles.blocked} testID="scan-edit-far">
            <Text style={styles.blockedText}>{copy.editFarBody(formatFeetInches(reading), formatFeetInches(target.currentM))}</Text>
          </View>
        )}
        <Text style={bad ? styles.errorText : styles.note}>{bad ? copy.editInvalidBody : copy.editHintBody}</Text>
        <Text style={styles.note}>{copy.editRecordNote}</Text>
      </View>
    </Sheet>
  );
}
