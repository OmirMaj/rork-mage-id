// components/payApp/SovImportSheet.tsx — import a schedule of values from
// pasted rows or a .csv / .tsv file. Easier Pay Applications, Phase 1.
//
// Three steps on one sheet, and NOTHING IS WRITTEN before the last tap:
//   1. Paste rows or pick a file.
//   2. See the first rows under each column the app picked, and change a
//      column if it picked wrong.
//   3. See what will be imported: rows read, rows left out and why, the sum
//      against the contract sum (a difference is shown, never blocked), then
//      choose how it lands.
//
// The reading and the rules are utils/payApp/sovSpreadsheet: no row is
// silently dropped, a cell that is not an amount is never read as zero, and on
// an application with money on it the import never writes previous work, this
// period or stored materials and never removes a line.
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Button, Sheet } from '@/components/ui';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { showAlert } from '@/utils/alert';
import type { AIAPayApplication } from '@/utils/aiaBilling';
import { formatMoney } from '@/utils/formatters';
import {
  SOV_FIELDS, SOV_FIELD_LABEL, SOV_IMPORT_COPY, SOV_IMPORT_ROW_CAP, applySovImport, detectSovColumns,
  planSovImport, readDelimited, sovImportModesFor, sovImportPreview,
  type SovColumnMapping, type SovField, type SovImportMode,
} from '@/utils/payApp/sovSpreadsheet';
import { makePayAppStyles } from './styles';

export interface SovImportSheetProps {
  visible: boolean;
  app: AIAPayApplication;
  onClose: () => void;
  /** The contractor confirmed: here is the application with the rows on it. */
  onApply: (next: AIAPayApplication, summary: { updated: number; added: number }) => void;
}

const columnLetter = (i: number): string => String.fromCharCode(65 + (i % 26));

const MODE_COPY: Record<SovImportMode, { label: string; hint: string }> = {
  replace_all: { label: SOV_IMPORT_COPY.replaceAll, hint: SOV_IMPORT_COPY.replaceAllHint },
  update_and_append: { label: SOV_IMPORT_COPY.updateAndAdd, hint: SOV_IMPORT_COPY.updateAndAddHint },
  append: { label: SOV_IMPORT_COPY.appendAll, hint: SOV_IMPORT_COPY.appendAllHint },
};

export function SovImportSheet({ visible, app, onClose, onApply }: SovImportSheetProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makePayAppStyles);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<SovColumnMapping>({});
  const [hasHeader, setHasHeader] = useState(false);
  const [columnCount, setColumnCount] = useState(0);

  const reset = useCallback(() => { setText(''); setRows(null); setMapping({}); setHasHeader(false); setColumnCount(0); }, []);
  const close = useCallback(() => { reset(); onClose(); }, [reset, onClose]);

  const read = useCallback((source: string) => {
    // A spreadsheet file is a zip, not text.
    if (source.startsWith('PK')) {
      showAlert(SOV_IMPORT_COPY.couldNotRead, SOV_IMPORT_COPY.spreadsheetFileBody);
      return;
    }
    const { rows: parsed, unterminatedQuoteRow } = readDelimited(source);
    // A quotation mark left open swallows every row after it into one cell.
    // Say so; do not import a guess.
    if (unterminatedQuoteRow != null) {
      showAlert(SOV_IMPORT_COPY.couldNotRead, SOV_IMPORT_COPY.unterminatedQuoteBody(unterminatedQuoteRow));
      return;
    }
    if (parsed.length === 0) {
      showAlert(SOV_IMPORT_COPY.couldNotRead, SOV_IMPORT_COPY.emptyBody);
      return;
    }
    const detected = detectSovColumns(parsed);
    setRows(parsed);
    setMapping(detected.mapping);
    setHasHeader(detected.hasHeader);
    setColumnCount(detected.columnCount);
  }, []);

  const pickFile = useCallback(async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/tab-separated-values', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];
      if (/\.(xlsx|xlsm|xls|numbers)$/i.test(asset.name ?? '')) {
        showAlert(SOV_IMPORT_COPY.couldNotRead, SOV_IMPORT_COPY.spreadsheetFileBody);
        return;
      }
      const source = Platform.OS === 'web'
        ? await (await fetch(asset.uri)).text()
        : await FileSystem.readAsStringAsync(asset.uri, { encoding: 'utf8' });
      read(source);
    } catch {
      showAlert(SOV_IMPORT_COPY.couldNotRead, SOV_IMPORT_COPY.emptyBody);
    }
  }, [read]);

  const plan = useMemo(
    () => (rows ? planSovImport({ rows, mapping, hasHeader }) : null),
    [rows, mapping, hasHeader],
  );
  const modes = useMemo(() => sovImportModesFor(app), [app]);
  const sample = useCallback((col: number): string => {
    if (!rows) return '';
    const body = hasHeader ? rows.slice(1) : rows;
    return body.slice(0, 5).map(r => (r[col] ?? '').trim()).filter(Boolean).join(', ');
  }, [rows, hasHeader]);

  const setField = useCallback((field: SovField, col: number | undefined) => {
    setMapping((prev) => {
      const next: SovColumnMapping = { ...prev };
      // One column feeds one field.
      for (const f of SOV_FIELDS) if (col != null && next[f] === col) delete next[f];
      if (col == null) delete next[field]; else next[field] = col;
      return next;
    });
  }, []);

  const apply = useCallback((mode: SovImportMode) => {
    if (!plan || plan.rows.length === 0) return;
    const outcome = applySovImport({ app, plan, mode, idSeed: Date.now().toString(36) });
    if (outcome.refused) return;
    onApply(outcome.app, { updated: outcome.updated, added: outcome.added });
    reset();
  }, [plan, app, onApply, reset]);

  // What the schedule of values would add up to under each way of landing:
  // the RESULT, which is what he compares with his contract sum.
  const previews = useMemo(() => {
    const out: Partial<Record<SovImportMode, ReturnType<typeof sovImportPreview>>> = {};
    if (plan && plan.rows.length > 0) for (const mode of modes) out[mode] = sovImportPreview({ app, plan, mode });
    return out;
  }, [plan, modes, app]);

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={SOV_IMPORT_COPY.title}
      size="wide"
      testID="sov-import"
      secondaryAction={rows
        ? { label: SOV_IMPORT_COPY.back, onPress: () => setRows(null), testID: 'sov-import-back' }
        : { label: SOV_IMPORT_COPY.cancel, onPress: close, testID: 'sov-import-cancel' }}
    >
      {!rows ? (
        <View style={{ gap: 10 }}>
          <Text style={styles.lead}>{SOV_IMPORT_COPY.pasteHint}</Text>
          <TextInput
            style={styles.pasteInput}
            value={text}
            onChangeText={setText}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={SOV_IMPORT_COPY.pasteLabel}
            testID="sov-import-paste"
          />
          <View style={styles.toolRow}>
            <Button label={SOV_IMPORT_COPY.readRows} onPress={() => read(text)} disabled={!text.trim()} testID="sov-import-read" />
            <Button label={SOV_IMPORT_COPY.pickFile} onPress={pickFile} variant="secondary" testID="sov-import-pick" />
          </View>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Text style={styles.heading}>{SOV_IMPORT_COPY.mappingHeading}</Text>
          <Text style={styles.note}>{SOV_IMPORT_COPY.mappingHint}</Text>
          <Pressable
            onPress={() => setHasHeader(v => !v)}
            style={[styles.toolBtn, hasHeader && styles.toolBtnOn, { alignSelf: 'flex-start' }]}
            accessibilityRole="switch"
            accessibilityState={{ checked: hasHeader }}
            accessibilityLabel={SOV_IMPORT_COPY.firstRowIsHeader}
            testID="sov-import-header"
          >
            <Text style={styles.toolBtnText}>{SOV_IMPORT_COPY.firstRowIsHeader}</Text>
          </Pressable>
          {SOV_FIELDS.map((field) => {
            const picked = mapping[field];
            return (
              <View key={field} style={styles.mapRow}>
                <Text style={styles.mapLabel}>{SOV_FIELD_LABEL[field]}</Text>
                <View style={styles.chipRow}>
                  <Pressable
                    onPress={() => setField(field, undefined)}
                    style={[styles.chip, picked == null && styles.chipOn]}
                    accessibilityRole="button"
                    accessibilityLabel={`${SOV_FIELD_LABEL[field]}: ${SOV_IMPORT_COPY.notMapped}`}
                  >
                    <Text style={[styles.chipText, picked == null && styles.chipTextOn]}>{SOV_IMPORT_COPY.notMapped}</Text>
                  </Pressable>
                  {Array.from({ length: columnCount }, (_, i) => (
                    <Pressable
                      key={i}
                      onPress={() => setField(field, i)}
                      style={[styles.chip, picked === i && styles.chipOn]}
                      accessibilityRole="button"
                      accessibilityLabel={`${SOV_FIELD_LABEL[field]}: Column ${columnLetter(i)}`}
                      testID={`sov-import-map-${field}-${i}`}
                    >
                      <Text style={[styles.chipText, picked === i && styles.chipTextOn]}>{columnLetter(i)}</Text>
                    </Pressable>
                  ))}
                </View>
                {picked != null && sample(picked) ? <Text style={styles.mapSample} numberOfLines={2}>{sample(picked)}</Text> : null}
              </View>
            );
          })}

          <Text style={styles.heading}>{SOV_IMPORT_COPY.summaryHeading}</Text>
          {!plan || !plan.mappable ? (
            <Text style={styles.note}>{SOV_IMPORT_COPY.needColumns}</Text>
          ) : (
            <View style={{ gap: 4 }} testID="sov-import-summary">
              <Text style={styles.lead}>{SOV_IMPORT_COPY.rowsLine(plan.rows.length)}</Text>
              {plan.skippedBlank > 0 ? <Text style={styles.note}>{SOV_IMPORT_COPY.blankLine(plan.skippedBlank)}</Text> : null}
              {plan.skippedTotals > 0 ? <Text style={styles.note}>{SOV_IMPORT_COPY.totalsLine(plan.skippedTotals)}</Text> : null}
              {plan.bad.length > 0 ? (
                <View style={{ gap: 2 }} testID="sov-import-bad">
                  <Text style={styles.badRow}>{SOV_IMPORT_COPY.badLine(plan.bad.length)}</Text>
                  {plan.bad.slice(0, 20).map(b => (
                    <Text key={`${b.rowNumber}-${b.reason}`} style={styles.badRow}>{SOV_IMPORT_COPY.badRow(b.rowNumber, b.reason)}</Text>
                  ))}
                </View>
              ) : null}
              {plan.overCap > 0 ? (
                <Text style={styles.badRow} testID="sov-import-over-cap">{SOV_IMPORT_COPY.overCapLine(SOV_IMPORT_ROW_CAP, plan.overCap)}</Text>
              ) : null}
              {plan.duplicateItemNos.length > 0 ? (
                <Text style={styles.badRow} testID="sov-import-duplicates">{SOV_IMPORT_COPY.duplicateLine(plan.duplicateItemNos)}</Text>
              ) : null}
              <View style={styles.sumRow}>
                <Text style={styles.sumLabel}>{SOV_IMPORT_COPY.contractLabel}</Text>
                <Text style={styles.sumValue}>{formatMoney(app.contractSumToDate, 2)}</Text>
              </View>
              {plan.rows.length === 0 ? (
                <Text style={styles.note}>{SOV_IMPORT_COPY.nothingToImport}</Text>
              ) : modes.map(mode => (
                <Pressable
                  key={mode}
                  onPress={() => apply(mode)}
                  style={styles.modeBtn}
                  accessibilityRole="button"
                  accessibilityLabel={MODE_COPY[mode].label}
                  testID={`sov-import-apply-${mode}`}
                >
                  <Text style={styles.modeName}>{MODE_COPY[mode].label}</Text>
                  <Text style={styles.modeHint}>{MODE_COPY[mode].hint}</Text>
                  {previews[mode] ? (
                    <View testID={`sov-import-result-${mode}`}>
                      <View style={styles.sumRow}>
                        <Text style={styles.sumLabel}>{SOV_IMPORT_COPY.afterImportLabel}</Text>
                        <Text style={styles.sumValue}>{formatMoney(previews[mode]!.total, 2)}</Text>
                      </View>
                      <View style={styles.sumRow}>
                        <Text style={styles.sumLabel}>{SOV_IMPORT_COPY.differenceLabel}</Text>
                        <Text style={styles.sumValue}>
                          {Math.abs(previews[mode]!.difference) <= 0.01 ? SOV_IMPORT_COPY.noDifference : formatMoney(previews[mode]!.difference, 2)}
                        </Text>
                      </View>
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}
    </Sheet>
  );
}
