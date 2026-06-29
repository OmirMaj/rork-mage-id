// CSIDivisionPicker — a reusable controlled trigger+modal for selecting a
// CSI MasterFormat 2020 division. Backed by the existing CSI_DIVISIONS
// catalog in utils/csiMasterFormat.ts (no duplication). The trigger is a
// small pill the caller embeds anywhere; tapping opens an internal modal
// with optional auto-suggest (driven by suggestFromText →
// classifyToCSIDivision), a search box, and the full 50-division list.
import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ScrollView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, X, Search } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  CSI_DIVISIONS,
  csiDivisionLabel,
  classifyToCSIDivision,
} from '@/utils/csiMasterFormat';

export interface CSIDivisionPickerProps {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  /** Free-text used by classifyToCSIDivision for the in-modal "Suggested" affordance. */
  suggestFromText?: string;
  testID?: string;
}

export function CSIDivisionPicker(props: CSIDivisionPickerProps): React.JSX.Element {
  const { value, onChange, suggestFromText, testID } = props;
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');

  const suggested: string | null = useMemo(() => {
    if (!suggestFromText || !suggestFromText.trim()) return null;
    const guess = classifyToCSIDivision(suggestFromText);
    if (!guess || guess === value) return null;
    return guess;
  }, [suggestFromText, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CSI_DIVISIONS;
    return CSI_DIVISIONS.filter((d) => {
      if (d.number.toLowerCase().includes(q)) return true;
      if (d.title.toLowerCase().includes(q)) return true;
      for (const ex of d.examples) {
        if (ex.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [query]);

  const triggerLabel = value ? csiDivisionLabel(value) : 'Pick CSI division';

  const select = (code: string | undefined) => {
    onChange(code);
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setOpen(true)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={value ? `CSI division ${triggerLabel}` : 'Pick CSI division'}
        testID={testID}
      >
        <Text
          style={[styles.triggerText, !value && styles.triggerTextMuted]}
          numberOfLines={1}
        >
          {triggerLabel}
        </Text>
        <ChevronDown size={14} color={themeColors.textMuted} strokeWidth={1.75} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop} onTouchEnd={() => setOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>CSI MasterFormat division</Text>
            <TouchableOpacity
              onPress={() => setOpen(false)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>

          {suggested && (
            <TouchableOpacity
              style={styles.suggestRow}
              onPress={() => select(suggested)}
              activeOpacity={0.85}
              testID="csi-suggest"
            >
              <MageAIMark size={14} color={themeColors.accent} />
              <Text style={styles.suggestText} numberOfLines={1}>
                Suggested · {csiDivisionLabel(suggested)}
              </Text>
            </TouchableOpacity>
          )}

          <View style={styles.searchRow}>
            <Search size={14} color={themeColors.textMuted} strokeWidth={1.75} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search division, title, or scope"
              placeholderTextColor={themeColors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          >
            {filtered.map((d) => {
              const selected = d.number === value;
              const exampleHint = d.examples.slice(0, 3).join(' · ');
              return (
                <TouchableOpacity
                  key={d.number}
                  style={[styles.row, selected && styles.rowSelected]}
                  onPress={() => select(d.number)}
                  activeOpacity={0.8}
                  testID={`csi-div-${d.number}`}
                >
                  <View style={styles.rowNumberPill}>
                    <Text style={styles.rowNumber}>{d.number}</Text>
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{d.title}</Text>
                    {exampleHint.length > 0 && (
                      <Text style={styles.rowHint} numberOfLines={1}>{exampleHint}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
            {filtered.length === 0 && (
              <Text style={styles.emptyText}>No divisions match &quot;{query}&quot;.</Text>
            )}
          </ScrollView>

          <View style={styles.footer}>
            {value !== undefined && (
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={() => select(undefined)}
                activeOpacity={0.8}
                testID="csi-clear"
              >
                <Text style={styles.clearBtnText}>Clear</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => setOpen(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  trigger: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 1,
    borderColor: themeColors.line,
    alignSelf: 'flex-start' as const,
  },
  triggerText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
  },
  triggerTextMuted: {
    color: themeColors.textMuted,
    fontWeight: '500' as const,
  },
  backdrop: {
    position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute' as const, left: 0, right: 0, bottom: 0,
    maxHeight: '85%' as const,
    backgroundColor: themeColors.bg,
    borderTopLeftRadius: Tokens.radius.lg,
    borderTopRightRadius: Tokens.radius.lg,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  sheetHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    color: themeColors.text,
  },
  suggestRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accent + '14',
    borderWidth: 1,
    borderColor: themeColors.accent + '40',
    marginBottom: 10,
  },
  suggestText: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: themeColors.accent,
  },
  searchRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 12,
    minHeight: 40,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 1,
    borderColor: themeColors.line,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: Type.subhead.fontSize,
    color: themeColors.text,
    paddingVertical: Platform.OS === 'web' ? 8 : 0,
  },
  list: { flexGrow: 0 },
  listContent: { paddingBottom: 6 },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: Tokens.radius.md,
  },
  rowSelected: { backgroundColor: themeColors.accent + '12' },
  rowNumberPill: {
    minWidth: 36,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: Tokens.radius.sm,
    backgroundColor: themeColors.surfaceAlt,
    alignItems: 'center' as const,
  },
  rowNumber: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '800' as const,
    color: themeColors.text,
    letterSpacing: 0.5,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  rowHint: {
    marginTop: 2,
    fontSize: 11,
    color: themeColors.textMuted,
  },
  emptyText: {
    paddingVertical: 18,
    textAlign: 'center' as const,
    color: themeColors.textMuted,
    fontSize: Type.caption1.fontSize,
  },
  footer: {
    flexDirection: 'row' as const,
    gap: 8,
    paddingTop: 10,
  },
  clearBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 1,
    borderColor: themeColors.line,
    alignItems: 'center' as const,
  },
  clearBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.text + '08',
    alignItems: 'center' as const,
  },
  cancelBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
});
