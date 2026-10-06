// components/roomScan/EditMeasureSheet.tsx — type a tape measurement over a scanned number.
//
// The person types what the tape says ("8 ft 2 in", "8 2", "98 in"). The sheet
// reads it with utils/roomScan/units.parseTapeMeasure, the one reader, and
// hands back metres. It changes nothing by itself: the caller applies the
// correction (utils/roomScan/editsCore), which records it as typed by hand.
import React, { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Sheet } from '@/components/ui';
import type { RoomScanCopy, RoomScanEditKind } from '@/hooks/useRoomScanCopy';
import { formatFeetInches, parseTapeMeasure } from '@/utils/roomScan/units';
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
  useEffect(() => { setText(''); setBad(false); }, [target]);
  if (!target) return null;
  const submit = () => {
    const m = parseTapeMeasure(text);
    if (m == null) { setBad(true); return; }
    onSave(m);
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
          onChangeText={(v) => { setText(v); setBad(false); }}
          placeholderTextColor={colors.textMuted}
          autoFocus
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
          onSubmitEditing={submit}
          accessibilityLabel={copy.editInputLabel}
        />
        <Text style={bad ? styles.errorText : styles.note}>{bad ? copy.editInvalidBody : copy.editHintBody}</Text>
        <Text style={styles.note}>{copy.editRecordNote}</Text>
      </View>
    </Sheet>
  );
}
