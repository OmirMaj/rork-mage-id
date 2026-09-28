// components/scopeGaps/BuildingYearRow.tsx — the compact "year built" row on
// the Scope Code Gaps card (Bet 1). Shown only when the scope touches
// something the building's age matters for, or when a building line is on
// screen. It says where the year came from, lets him enter or change his own,
// and says the entered year is kept on this device (it is, in this slice).
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Button } from '@/components/ui';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { buildingYearChip, normalizeYearBuilt, type BuildingYear } from '@/utils/buildingScopeTriggers';
import {
  CANCEL, CHANGE_YEAR, ENTER_YEAR, REMOVE_YEAR, SAVED_ON_DEVICE, SAVE_YEAR, YEAR_MISSING_ELSEWHERE, YEAR_MISSING_NYC,
  plutoAsOf, yearBlockedReason,
} from '@/utils/buildingScopeCopy';

export interface BuildingYearRowProps {
  year: BuildingYear | null;
  pluto: BuildingYear | null;
  entered: BuildingYear | null;
  isNyc: boolean;
  currentYear: number;
  onSave: (year: number) => void;
  onRemove: () => void;
}

export function BuildingYearRow(p: BuildingYearRowProps): React.ReactElement {
  const styles = useThemedStyles(makeStyles);
  const { colors: t } = useTheme();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const parsed = normalizeYearBuilt(text, p.currentYear);
  const blocked = parsed == null ? yearBlockedReason(p.currentYear) : null;

  const open = () => {
    setText(p.entered ? String(p.entered.year) : '');
    setEditing(true);
  };
  const save = () => {
    if (parsed == null) return;
    p.onSave(parsed);
    setEditing(false);
  };

  return (
    <View style={styles.root} testID="scopegaps-year-row">
      {p.year ? (
        <View style={styles.inlineRow}>
          <Text style={styles.chip}>{buildingYearChip(p.year, p.pluto)}</Text>
          {!editing ? (
            <Button label={CHANGE_YEAR} size="sm" variant="ghost" onPress={open} testID="scopegaps-year-change" />
          ) : null}
        </View>
      ) : (
        <View>
          <Text style={styles.meta}>{p.isNyc ? YEAR_MISSING_NYC : YEAR_MISSING_ELSEWHERE}</Text>
          {!editing ? (
            <View style={styles.actionBlock}>
              <Button label={ENTER_YEAR} size="sm" variant="secondary" onPress={open} testID="scopegaps-year-enter" />
            </View>
          ) : null}
        </View>
      )}
      {p.pluto?.asOf && !editing ? <Text style={styles.meta}>{plutoAsOf(p.pluto.asOf)}</Text> : null}
      {p.entered && !editing ? <Text style={styles.meta}>{SAVED_ON_DEVICE}</Text> : null}

      {editing ? (
        <View style={styles.editor}>
          <View style={styles.inlineRow}>
            <TextInput
              value={text}
              onChangeText={v => setText(v.replace(/[^0-9]/g, '').slice(0, 4))}
              keyboardType="number-pad"
              placeholder="Year built"
              placeholderTextColor={t.textMuted}
              style={styles.input}
              accessibilityLabel="Year built"
              testID="scopegaps-year-input"
            />
            <Button label={SAVE_YEAR} size="sm" variant="secondary" disabled={!!blocked} onPress={save} testID="scopegaps-year-save" />
            <Button label={CANCEL} size="sm" variant="ghost" onPress={() => setEditing(false)} testID="scopegaps-year-cancel" />
          </View>
          {blocked && text.trim() !== '' ? <Text style={styles.meta}>{blocked}</Text> : null}
          <Text style={styles.meta}>{SAVED_ON_DEVICE}</Text>
          {p.entered ? (
            <Button
              label={REMOVE_YEAR} size="sm" variant="ghost"
              onPress={() => { p.onRemove(); setEditing(false); }}
              testID="scopegaps-year-remove"
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default BuildingYearRow;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { marginTop: Tokens.spacing.xs },
  meta: { ...Type.footnote, color: t.textSecondary, marginTop: Tokens.spacing.xxs, flexShrink: 1 },
  chip: {
    ...Type.caption1, color: t.textSecondary, backgroundColor: t.neutralSoft,
    paddingHorizontal: Tokens.spacing.xs, paddingVertical: Tokens.spacing.xxs,
    borderRadius: Tokens.radius.xs, alignSelf: 'flex-start',
  },
  inlineRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Tokens.spacing.xs, marginTop: Tokens.spacing.xxs },
  actionBlock: { marginTop: Tokens.spacing.xs, alignItems: 'flex-start' },
  editor: { marginTop: Tokens.spacing.xxs, alignItems: 'flex-start' },
  input: {
    ...Type.subhead, color: t.text, minWidth: 96,
    borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.sm,
    paddingHorizontal: Tokens.spacing.xs, paddingVertical: Tokens.spacing.xxs,
  },
});
