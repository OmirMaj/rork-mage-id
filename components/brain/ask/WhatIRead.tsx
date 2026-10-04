// components/brain/ask/WhatIRead.tsx — "What I read": the files a reading was
// built from (lane ATTASK). Under a file answer in Ask MAGE, and in the portal
// sheet's result.
//
// HONESTY. The list is what the server sent to the model, not what the model
// says it looked at: the names come back from the edge function with the
// answer, and a PDF's page count is counted there. When the answer was cut
// short the block says MAGE may not have got through all of it. It always ends
// with the caution that this is an AI reading.
//
// Not tappable in v1 (opening the file from here is on the v2 list). Flat: a
// hairline on the left, no card, no fill. Every string arrives in `copy`
// (useAskCopy().files), so this file reads no translation of its own.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AskTurnFile } from '@/types';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { AskCopy } from '@/hooks/useAskCopy';

export interface WhatIReadProps {
  files: AskTurnFile[];
  /** The answer was cut short: say the reading may be incomplete. */
  partial?: boolean;
  copy: AskCopy['files'];
}

function kindLabel(f: AskTurnFile, copy: AskCopy['files']): string {
  if (f.kind === 'plan') return copy.readPlan;
  if (f.kind === 'pdf') {
    return typeof f.pages === 'number' && f.pages > 0 ? copy.readPdf(f.pages) : copy.readPdfNoCount;
  }
  return copy.readPhoto;
}

export function WhatIRead({ files, partial, copy }: WhatIReadProps) {
  const styles = useThemedStyles(makeStyles);
  if (!Array.isArray(files) || files.length === 0) return null;
  return (
    <View style={styles.wrap} accessibilityLabel={copy.readA11y(files.length)} testID="ask-what-i-read">
      <Text style={styles.heading}>{copy.readTitle}</Text>
      {files.map((f, i) => (
        <View key={`${i}-${f.name}`} style={styles.row}>
          <Text style={styles.name} numberOfLines={1} ellipsizeMode="middle">{f.name}</Text>
          <Text style={styles.kind} numberOfLines={1}>{kindLabel(f, copy)}</Text>
        </View>
      ))}
      {!!partial && <Text style={styles.note}>{copy.readPartial}</Text>}
      <Text style={styles.caution}>{copy.readCaution}</Text>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: {
    marginTop: 10, paddingLeft: 10, alignSelf: 'stretch',
    borderLeftWidth: 2, borderLeftColor: t.line,
  },
  heading: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.textMuted, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingVertical: 2 },
  name: { flexShrink: 1, fontSize: Type.footnote.fontSize, color: t.text },
  kind: { fontSize: Type.caption2.fontSize, color: t.textSecondary },
  note: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 4 },
  caution: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 4 },
});
