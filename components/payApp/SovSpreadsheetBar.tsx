// components/payApp/SovSpreadsheetBar.tsx — the schedule of values out to a
// spreadsheet: copy as tab-separated text, export a CSV file, copy the cover
// figures. Easier Pay Applications, Phase 1.
//
// What leaves is the contractor's own figures under MAGE ID's own headers
// (utils/payApp/sovSpreadsheet). No form name, no publisher's name, no logo,
// and one claim only: "Export your figures to type or paste into the software
// your owner requires."
import React, { useCallback, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { ClipboardCopy, FileDown, FileUp, ListChecks } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { showAlert } from '@/utils/alert';
import type { AIAPayApplication } from '@/utils/aiaBilling';
import { deliverTextFile } from '@/utils/platformFile';
import { REJECTION_COPY } from '@/utils/payApp/rejectionCopy';
import {
  SOV_EXPORT_COPY, SOV_IMPORT_COPY, coverFigureRows, sovExportCsv, sovExportFileName,
  sovExportTsv, toDelimited,
} from '@/utils/payApp/sovSpreadsheet';
import { makePayAppStyles } from './styles';

export interface SovSpreadsheetBarProps {
  app: AIAPayApplication;
  /** Shown only when the application can be edited. */
  onImport?: () => void;
  onOpenCheck: () => void;
}

export function SovSpreadsheetBar({ app, onImport, onOpenCheck }: SovSpreadsheetBarProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makePayAppStyles);
  const [entryOnly, setEntryOnly] = useState(false);

  const copyRows = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(sovExportTsv(app, { entryOnly }));
      showAlert(SOV_EXPORT_COPY.copiedTitle, SOV_EXPORT_COPY.copiedBody(app.lines.length));
    } catch {
      showAlert(SOV_EXPORT_COPY.exportFailedTitle, SOV_EXPORT_COPY.exportFailedBody);
    }
  }, [app, entryOnly]);

  const copyCover = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(toDelimited(coverFigureRows(app), '\t'));
      showAlert(SOV_EXPORT_COPY.copiedTitle, SOV_EXPORT_COPY.coverCopiedBody);
    } catch {
      showAlert(SOV_EXPORT_COPY.exportFailedTitle, SOV_EXPORT_COPY.exportFailedBody);
    }
  }, [app]);

  const exportCsv = useCallback(async () => {
    try {
      const uri = await deliverTextFile(sovExportFileName(app.applicationNumber), sovExportCsv(app, { entryOnly }), 'text/csv;charset=utf-8');
      // Web: the browser already downloaded it (uri is null).
      if (uri && Platform.OS !== 'web' && await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
      }
    } catch {
      showAlert(SOV_EXPORT_COPY.exportFailedTitle, SOV_EXPORT_COPY.exportFailedBody);
    }
  }, [app, entryOnly]);

  return (
    <View style={{ gap: 8 }} testID="sov-spreadsheet-bar">
      <View style={styles.toolRow}>
        <Pressable onPress={onOpenCheck} style={styles.toolBtn} accessibilityRole="button" accessibilityLabel={REJECTION_COPY.openA11y} testID="sov-open-check">
          <ListChecks size={15} color={colors.text} strokeWidth={2} />
          <Text style={styles.toolBtnText}>{REJECTION_COPY.open}</Text>
        </Pressable>
        {onImport ? (
          <Pressable onPress={onImport} style={styles.toolBtn} accessibilityRole="button" accessibilityLabel={SOV_IMPORT_COPY.open} testID="sov-import-open">
            <FileUp size={15} color={colors.text} strokeWidth={2} />
            <Text style={styles.toolBtnText}>{SOV_IMPORT_COPY.open}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={copyRows} style={styles.toolBtn} accessibilityRole="button" accessibilityLabel={SOV_EXPORT_COPY.copyForSpreadsheet} testID="sov-copy-tsv">
          <ClipboardCopy size={15} color={colors.text} strokeWidth={2} />
          <Text style={styles.toolBtnText}>{SOV_EXPORT_COPY.copyForSpreadsheet}</Text>
        </Pressable>
        <Pressable onPress={exportCsv} style={styles.toolBtn} accessibilityRole="button" accessibilityLabel={SOV_EXPORT_COPY.exportCsv} testID="sov-export-csv">
          <FileDown size={15} color={colors.text} strokeWidth={2} />
          <Text style={styles.toolBtnText}>{SOV_EXPORT_COPY.exportCsv}</Text>
        </Pressable>
        <Pressable onPress={copyCover} style={styles.toolBtn} accessibilityRole="button" accessibilityLabel={SOV_EXPORT_COPY.copyCover} testID="sov-copy-cover">
          <ClipboardCopy size={15} color={colors.text} strokeWidth={2} />
          <Text style={styles.toolBtnText}>{SOV_EXPORT_COPY.copyCover}</Text>
        </Pressable>
        <Pressable
          onPress={() => setEntryOnly(v => !v)}
          style={[styles.toolBtn, entryOnly && styles.toolBtnOn]}
          accessibilityRole="switch"
          accessibilityState={{ checked: entryOnly }}
          accessibilityLabel={SOV_EXPORT_COPY.entryOnly}
          testID="sov-entry-only"
        >
          <Text style={styles.toolBtnText}>{SOV_EXPORT_COPY.entryOnly}</Text>
        </Pressable>
      </View>
      <Text style={styles.note}>{SOV_EXPORT_COPY.claim}</Text>
    </View>
  );
}
