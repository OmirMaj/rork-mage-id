// components/livingModel/HonestyLines.tsx — the two lines every view of the
// model carries, the 3D one and the flat one alike:
//   "Schematic made from typed and scanned sizes. Not to scale for building."
//   "Progress shown is what was reported in MAGE ID."
// scripts/validate-living-model.ts fails if a view of the model is drawn
// without this component.
import React from 'react';
import { Text, View } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useLivingModelCopy } from '@/hooks/useLivingModelCopy';
import { makeLivingModelStyles } from './styles';

export function HonestyLines({ ghost = false, testID = 'living-model-honesty' }: { ghost?: boolean; testID?: string }) {
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  return (
    <View style={styles.honesty} testID={testID}>
      <Text style={styles.noteStrong}>{copy.schematicBody}</Text>
      <Text style={styles.note}>{ghost ? `${copy.progressBody} ${copy.ghostBody}` : copy.progressBody}</Text>
    </View>
  );
}
